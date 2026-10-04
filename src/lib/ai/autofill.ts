// Filling the profile from what a document says.
//
// Once a document has been read (documents.ts), what it proves goes onto the profile,
// so nobody has to type it:
//   IELTS result        → the IELTS score, from the most recent result on file
//   CAS / I-20          → readiness checklist "CAS / I-20 received"
//   visa grant          → "Visa granted" (not appointment letters or applications)
//   KCO guarantee (FGL) → "KCO request submitted"
//   a file that answers an open Missing Item → the item is marked received — only for files
//                         that arrived after the item was added, so an old upload can never
//                         clear a newer request
// Each change is logged in the AI activity log with its Undo. A document whose name does
// not match the student is never used.

import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from './client';
import { AI_DOC_MODEL } from './config';
import { logAiAction } from './action-log';
import type { DocCard } from './documents';

type StoredDoc = { id?: string; name?: string; uploadedAt?: string; ai?: DocCard };
type MissingItem = { id?: string; text?: string; createdAt?: string; passportExpiry?: string } | string;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const note = (content: string) => ({
  id: `note-ai-autofill-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  authorId: 'email-intake',
  content,
  createdAt: new Date().toISOString(),
});

const MATCH_SYSTEM = `A document was just uploaded to a student's file at a study-abroad agency. Decide which of the student's open Missing Items it satisfies. The items are written by staff, often in a mix of English and Arabic, and may add conditions (e.g. "original passport, not from the Sahel app" — a screenshot from the Sahel app does not satisfy it). Match only when the document clearly is what the item asks for, conditions included. Call record_matches once; return an empty list when none fits.`;

const MATCH_TOOL: Anthropic.Tool = {
  name: 'record_matches',
  description: 'The missing item ids this document satisfies.',
  input_schema: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'string' } } },
    required: ['ids'],
  },
};

async function checklistTick(
  studentId: string,
  studentName: string,
  current: Record<string, boolean> | undefined,
  key: string,
  label: string,
  doc: StoredDoc,
  dryRun = false,
): Promise<string | null> {
  if (current?.[key] === true) return null;
  if (dryRun) return `[preview] would tick "${label}"`;
  const field = `profileCompletionStatus.${key}`;
  await db()
    .collection('students')
    .doc(studentId)
    .update({ [field]: true, adminNotes: FieldValue.arrayUnion(note(`Ticked "${label}" from the document "${doc.name}" (AI).`)) });
  await logAiAction({
    source: 'document',
    summary: `Ticked "${label}"`,
    reason: `Document "${doc.name}": ${doc.ai?.summary ?? ''}`,
    studentId,
    studentName,
    undo: { type: 'set_field', field, from: current?.[key] ?? null, to: true },
  });
  return `Ticked "${label}"`;
}

/** Apply what one freshly read document proves. Returns what was done. Never throws. */
export async function applyDocumentFacts(studentId: string, doc: StoredDoc, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  const card = doc.ai;
  if (!card || card.status !== 'read' || card.matchesStudent === false || !adminDb) return [];
  const done: string[] = [];
  try {
    if ((await db().collection('app_settings').doc('ai_documents').get()).data()?.autoFill === false) return [];
    const snap = await db().collection('students').doc(studentId).get();
    const s = snap.data();
    if (!s || s.isClosed === true) return [];
    const name: string = s.name ?? '';
    const checklist = s.profileCompletionStatus as Record<string, boolean> | undefined;
    const f = card.facts ?? {};

    // IELTS: the score from the most recent result on file.
    if (card.type === 'ielts' && typeof f.ieltsOverall === 'number' && f.ieltsOverall > 0 && f.ieltsOverall <= 9) {
      const results = ((s.documents ?? []) as StoredDoc[])
        .filter((d) => d.ai?.status === 'read' && d.ai.type === 'ielts' && typeof d.ai.facts?.ieltsOverall === 'number' && d.ai.matchesStudent !== false)
        .map((d) => ({ id: d.id, when: d.ai!.facts.testDate ?? d.uploadedAt ?? '' }));
      if (!results.some((r) => r.id === doc.id)) results.push({ id: doc.id, when: f.testDate ?? doc.uploadedAt ?? '' });
      const latest = results.sort((a, b) => String(b.when).localeCompare(String(a.when)))[0];
      // A score typed by staff after this test (or after this file was uploaded) wins.
      const manualAt = ((s.adminNotes ?? []) as Array<{ content?: string; createdAt?: string; authorId?: string }>)
        .filter((n) => /^IELTS updated to/.test(String(n.content ?? '')) && n.authorId !== 'email-intake')
        .map((n) => String(n.createdAt ?? ''))
        .sort()
        .pop();
      const evidenceAt = String(f.testDate ?? doc.uploadedAt ?? '');
      const newerThanManual = !manualAt || !s.ieltsOverall || evidenceAt >= manualAt.slice(0, evidenceAt.length);
      if (!newerThanManual) {
        /* staff typed a score after this result — leave it */
      } else if (latest?.id === doc.id && s.ieltsOverall !== f.ieltsOverall && opts.dryRun) {
        done.push(`[preview] would set IELTS to ${f.ieltsOverall} (now ${s.ieltsOverall ?? 'empty'})`);
      } else if (latest?.id === doc.id && s.ieltsOverall !== f.ieltsOverall) {
        await snap.ref.update({
          ieltsOverall: f.ieltsOverall,
          adminNotes: FieldValue.arrayUnion(note(`IELTS updated to ${f.ieltsOverall} from "${doc.name}"${f.testDate ? ` (test ${f.testDate})` : ''} (AI).`)),
        });
        await logAiAction({
          source: 'document',
          summary: `IELTS set to ${f.ieltsOverall}${s.ieltsOverall ? ` (was ${s.ieltsOverall})` : ''}`,
          reason: `Document "${doc.name}": ${card.summary}`,
          studentId,
          studentName: name,
          undo: { type: 'set_field', field: 'ieltsOverall', from: s.ieltsOverall ?? null, to: f.ieltsOverall },
        });
        done.push(`IELTS set to ${f.ieltsOverall}`);
      }
    }

    // Readiness checklist.
    if (card.type === 'cas' || card.type === 'i20') {
      const r = await checklistTick(studentId, name, checklist, 'receivedCasOrI20', 'CAS / I-20 received', doc, opts.dryRun);
      if (r) done.push(r);
    }
    if (card.type === 'visa' && /grant|approv|issued|valid from|vignette|evisa|e-visa/i.test(card.summary) && !/appointment|application form|biometric|receipt|refus/i.test(card.summary)) {
      const r = await checklistTick(studentId, name, checklist, 'visaGranted', 'Visa granted', doc, opts.dryRun);
      if (r) done.push(r);
    }
    if ((card.type === 'mohe' || card.type === 'financial') && /guarantee|ضمان|sponsorship letter/i.test(`${card.title} ${card.summary}`)) {
      const r = await checklistTick(studentId, name, checklist, 'submitKcoRequest', 'KCO request submitted', doc, opts.dryRun);
      if (r) done.push(r);
    }

    // "Renewed passport" (opened by a passport warning, deadlines.ts) is closed by rule, not
    // by the model: only a passport that expires after the one that was flagged answers it.
    if (card.type === 'passport' && /^\d{4}-\d{2}-\d{2}$/.test(f.expiryDate ?? '')) {
      const renewed = ((s.missingItems ?? []) as MissingItem[]).filter(
        (m): m is { id: string; text: string; passportExpiry: string } =>
          typeof m !== 'string' && String(m.id ?? '').startsWith('mi-ai-passport-') && !!m.passportExpiry && m.passportExpiry < f.expiryDate!,
      );
      if (renewed.length && opts.dryRun) {
        done.push(`[preview] would mark received: ${renewed.map((m) => m.text).join(' · ')}`);
      } else if (renewed.length) {
        await snap.ref.update({
          missingItems: FieldValue.arrayRemove(...renewed),
          adminNotes: FieldValue.arrayUnion(note(`Marked as received from "${doc.name}" (AI): new passport expires ${f.expiryDate}`)),
        });
        await logAiAction({
          source: 'document',
          summary: `Missing Item marked received: ${renewed.map((m) => m.text).join(' · ')}`,
          reason: `Document "${doc.name}": passport expiring ${f.expiryDate}`,
          studentId,
          studentName: name,
          undo: { type: 'restore_missing_items', items: renewed },
        });
        done.push(`Missing Item received: ${renewed.map((m) => m.text).join(' · ')}`);
      }
    }

    // Missing Items this document answers. Email-requested items are left to the
    // email flow, which also drafts the reply; only items older than the file count.
    const open = ((s.missingItems ?? []) as MissingItem[]).filter(
      (m): m is { id: string; text: string; createdAt?: string } =>
        typeof m !== 'string' &&
        !!m.id &&
        !String(m.id).startsWith('mi-email-') &&
        !String(m.id).startsWith('mi-ai-passport-') &&
        String(m.createdAt ?? '') < String(doc.uploadedAt ?? ''),
    );
    if (open.length) {
      const res = await getAnthropicClient('documents').messages.create({
        model: AI_DOC_MODEL,
        max_tokens: 400,
        system: MATCH_SYSTEM,
        tools: [MATCH_TOOL],
        messages: [
          {
            role: 'user',
            content: [
              `Document: "${doc.name}" — read as ${card.type}: ${card.title}. ${card.summary}`,
              '',
              'Open Missing Items:',
              ...open.map((m) => `- ${m.id}: ${m.text}`),
            ].join('\n'),
          },
        ],
      });
      const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
      const ids = new Set(((use?.input as any)?.ids ?? []) as string[]);
      const matched = open.filter((m) => ids.has(m.id));
      if (matched.length && opts.dryRun) {
        done.push(`[preview] would mark received: ${matched.map((m) => m.text).join(' · ')}`);
      } else if (matched.length) {
        await snap.ref.update({
          missingItems: FieldValue.arrayRemove(...matched),
          adminNotes: FieldValue.arrayUnion(
            note(`Marked as received from "${doc.name}" (AI): ${matched.map((m) => `"${m.text}"`).join(', ')}`),
          ),
        });
        await logAiAction({
          source: 'document',
          summary: `Missing Item${matched.length > 1 ? 's' : ''} marked received: ${matched.map((m) => m.text).join(' · ')}`,
          reason: `Document "${doc.name}": ${card.summary}`,
          studentId,
          studentName: name,
          undo: { type: 'restore_missing_items', items: matched },
        });
        done.push(`Missing Item received: ${matched.map((m) => m.text).join(' · ')}`);
      }
    }
  } catch (e) {
    console.error('[autofill] failed:', e);
  }
  return done;
}
