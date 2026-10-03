// Company-wide news in an email, applied to every student it affects.
//
// A company answers one student's email with something that is true for everyone:
// "all applications for Pharmacy at Portsmouth are closed for September", "we cannot
// submit to Bath at the moment", "applications have reopened". The AI recognises these,
// keeps them as notices (so later emails and applications are read in their light), and
// reacts across the whole student base:
//
//   closed / paused (new applications)
//       Pending and Missing Items applications for it → Rejected, reason quoting the notice
//       (they can no longer be submitted — the agency's rule for Rejected);
//       Submitted ones are left as they are, with a note — the email does not say they died;
//       the course is marked closed in Approved Universities.
//   closed (all applications)
//       Pending, Missing Items and Submitted → Rejected.
//   reopened
//       The course is marked open again; students are told in the chat. Nothing is
//       un-rejected automatically — that needs a person.
//   other (a changed requirement, a new deadline…)
//       A note to each affected student; no status changes.
//
// Accepted and Rejected applications are never touched. Every affected student gets an
// admin note and a chat message, and the full list goes into the email's summary.
//
// "Not approved by the KCO" is checked against the Approved Universities list first: when
// the list shows the course as approved, nothing is rejected or closed — the students are
// flagged and a person is asked to confirm with the KCO (kco.ts).

import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_DOC_MODEL, isAiConfigured } from '@/lib/ai/config';
import { CHAT_BOT_USER_ID, ensureChatBotUser } from '@/lib/ai/chat-bot';
import { sendChatMessage, updateApplicationStatus } from '@/lib/actions';
import { companyForAddress } from './companies';
import { newestMessage } from './text';
import type { InboxMessage } from './inbox';
import type { Application, ApplicationStatus } from '@/lib/types';
import { logAiAction } from '@/lib/ai/action-log';
import { aboutKcoApproval, approvedRowsFor } from './kco';

export const NOTICE_COLLECTION = 'company_notices';

type NoticeKind = 'closed' | 'paused' | 'reopened' | 'other';
type Notice = {
  kind: NoticeKind;
  /** 'new' — no new applications; 'all' — existing ones are affected too. */
  scope: 'new' | 'all';
  university: string;
  course: string | null;
  intake: string | null;
  summary: string;
  evidence: string;
  /** The notice says the KCO / MOHE does not approve it. */
  kcoApproval: boolean;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const DETECT_SYSTEM = `You read emails that universities, pathway providers and agents (Merit, INTO, Study Group, Navitas…) send to a Kuwaiti study-abroad agency. Most are about one student. Your job is to spot statements that are true for OTHER students too, and call record_notices once.

A notice is a general statement about a university, college, course or intake, for example:
- "all applications for this major/course are stopped / closed / full", "we are no longer accepting applications for…", "the September intake for … is closed" → kind "closed"
- "we cannot submit applications to … at the moment / temporarily unavailable / on hold" → kind "paused"
- "this course / university is not approved by the KCO (Kuwait Cultural Office) / MOHE" → kind "closed", scope "all" — sponsored students cannot take it at all"
- "applications for … are open again / we can now submit to …" → kind "reopened"
- a changed entry requirement, a new deadline, a new document required for everyone applying to … → kind "other"

scope: "new" when only new applications are affected (the usual case); "all" only when the email says existing applications are cancelled or will not be processed either.

Not a notice: a decision about this one student (their offer, their rejection, their missing document), marketing, newsletters, general greetings. Only use the newest message — quoted older messages are not included. If there is no notice, return an empty list.`;

const DETECT_TOOL: Anthropic.Tool = {
  name: 'record_notices',
  description: 'Record the general notices in this email.',
  input_schema: {
    type: 'object',
    properties: {
      notices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['closed', 'paused', 'reopened', 'other'] },
            scope: { type: 'string', enum: ['new', 'all'] },
            university: { type: 'string', description: 'University / college as named.' },
            course: { type: ['string', 'null'], description: 'Course, major or programme, if the notice is limited to one.' },
            intake: { type: ['string', 'null'] },
            summary: { type: 'string', description: 'One line for staff.' },
            evidence: { type: 'string', description: 'The exact words.' },
            kcoApproval: { type: 'boolean', description: 'true when the notice is that the KCO / MOHE does not approve it.' },
          },
          required: ['kind', 'scope', 'university', 'summary', 'evidence'],
        },
      },
    },
    required: ['notices'],
  },
};

const MATCH_SYSTEM = `You decide which student applications a notice applies to. Each candidate is "id. university — major (status)". An application is affected only if it is clearly at the same university/college AND, when the notice names a course or major, the same course or major (allow naming differences: "Pharmacy" = "MPharm", "Kaplan Liverpool" = "University of Liverpool - kaplan"). When unsure, leave it out. Call record_affected once.`;

const MATCH_TOOL: Anthropic.Tool = {
  name: 'record_affected',
  description: 'The candidate ids the notice applies to.',
  input_schema: {
    type: 'object',
    properties: { ids: { type: 'array', items: { type: 'integer' } } },
    required: ['ids'],
  },
};

async function detect(message: InboxMessage): Promise<Notice[]> {
  const res = await getAnthropicClient('notices').messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 1200,
    system: [{ type: 'text', text: DETECT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [DETECT_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
          `Subject: ${message.subject}`,
          `Date: ${message.date.slice(0, 10)}`,
          '',
          newestMessage(message.text).slice(0, 8000),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return (((use?.input as any)?.notices ?? []) as any[])
    .filter((n) => ['closed', 'paused', 'reopened', 'other'].includes(n?.kind) && typeof n.university === 'string')
    .map((n) => ({
      kind: n.kind,
      scope: n.scope === 'all' ? 'all' : 'new',
      university: n.university.slice(0, 160),
      course: typeof n.course === 'string' ? n.course.slice(0, 160) : null,
      intake: typeof n.intake === 'string' ? n.intake : null,
      summary: String(n.summary ?? '').slice(0, 300),
      evidence: String(n.evidence ?? '').slice(0, 400),
      kcoApproval: aboutKcoApproval(n.kcoApproval, String(n.summary ?? ''), String(n.evidence ?? '')),
    }));
}

/** Words that identify a university, without the generic ones every name shares. */
function keyWords(name: string): string[] {
  const stop = new Set(['university', 'of', 'the', 'college', 'international', 'study', 'centre', 'center', 'school', 'and', 'into', 'kaplan', 'navitas', 'oncampus', 'on', 'compus', 'campus', 'group', 'in', 'house', 'isc', 'pathway', 'pathways', 'london']);
  return name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !stop.has(w));
}

type Candidate = { studentId: string; studentName: string; employeeId: string | null; app: Application };

async function candidatesFor(n: Notice): Promise<Candidate[]> {
  const words = keyWords(n.university);
  if (!words.length) return [];
  const snap = await db().collection('students').select('name', 'applications', 'isClosed', 'employeeId').get();
  const out: Candidate[] = [];
  for (const d of snap.docs) {
    const s = d.data();
    if (s.isClosed === true) continue;
    for (const a of (s.applications ?? []) as Application[]) {
      const uni = a.university.toLowerCase();
      if (words.some((w) => uni.includes(w))) out.push({ studentId: d.id, studentName: s.name, employeeId: s.employeeId ?? null, app: a });
    }
  }
  return out;
}

async function affected(n: Notice, candidates: Candidate[]): Promise<Candidate[]> {
  if (!candidates.length) return [];
  const res = await getAnthropicClient('notices').messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 1500,
    system: MATCH_SYSTEM,
    tools: [MATCH_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `Notice: ${n.kind} — ${n.university}${n.course ? ` — ${n.course}` : ' (whole university)'}${n.intake ? ` — ${n.intake}` : ''}`,
          `"${n.evidence}"`,
          '',
          'Candidates:',
          ...candidates.map((c, i) => `${i}. ${c.app.university} — ${c.app.major} (${c.app.status})`),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const ids = new Set(((use?.input as any)?.ids ?? []) as number[]);
  return candidates.filter((_, i) => ids.has(i));
}

/**
 * Mark the Approved Universities rows the notice is about closed / open again.
 *
 * Word matching alone is not safe here — "University of East London" shares "east" with
 * East Anglia, "INTO Manchester" with Manchester. Words only shortlist the rows; the model
 * then picks the ones that really are the same university and course, the same way
 * affected() picks applications. Rows with no major are never matched to a course notice.
 */
async function updateApprovedUniversities(n: Notice, open: boolean): Promise<string[]> {
  const words = keyWords(n.university);
  if (!words.length) return [];
  const snap = await db().collection('approved_universities').get();
  const shortlist = snap.docs.filter((d) => {
    const u = d.data();
    if (u.isAvailable === open) return false;
    if (n.course && !String(u.major ?? '').trim()) return false;
    const name = String(u.name ?? '').toLowerCase();
    return words.some((w) => name.includes(w));
  });
  if (!shortlist.length) return [];
  const res = await getAnthropicClient('notices').messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 800,
    system: MATCH_SYSTEM,
    tools: [MATCH_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `Notice: ${n.kind} — ${n.university}${n.course ? ` — ${n.course}` : ' (whole university)'}`,
          `"${n.evidence}"`,
          '',
          'Candidates (Approved Universities rows):',
          ...shortlist.map((d, i) => `${i}. ${d.data().name} — ${d.data().major}`),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const ids = new Set(((use?.input as any)?.ids ?? []) as number[]);
  const changed: string[] = [];
  for (const [i, d] of shortlist.entries()) {
    if (!ids.has(i)) continue;
    const u = d.data();
    const note = `${open ? 'Reopened' : 'Closed'} per email ${new Date().toISOString().slice(0, 10)}: ${n.summary}`;
    const newNote = u.importantNote ? `${u.importantNote}\n${note}` : note;
    await d.ref.update({ isAvailable: open, importantNote: newNote });
    changed.push(`${u.name} — ${u.major}`);
    await logAiAction({
      source: 'notice',
      summary: `Approved Universities: ${u.name} — ${u.major} marked ${open ? 'open' : 'closed'}`,
      reason: n.summary,
      studentId: null,
      studentName: null,
      undo: {
        type: 'approved_university',
        universityId: d.id,
        isAvailable: u.isAvailable !== false,
        importantNote: u.importantNote ?? null,
        setTo: { isAvailable: open, importantNote: newNote },
      },
    });
  }
  return changed;
}

/**
 * Find notices in one email and act on them across all students. Returns summary lines.
 * dryRun works out who is affected but changes nothing. Never throws.
 */
export async function handleCompanyNotices(message: InboxMessage, opts: { dryRun?: boolean } = {}): Promise<string[]> {
  if (!isAiConfigured() || !adminDb) return [];
  try {
    if (!(await companyForAddress(message.from))) return [];
    // A retried email (released after a later step failed) must not apply its notices twice.
    if (!opts.dryRun && message.messageId) {
      const seen = await db().collection(NOTICE_COLLECTION).where('messageId', '==', message.messageId).limit(1).get();
      if (!seen.empty) return [];
    }
    const notices = await detect(message);
    const lines: string[] = [];
    const company = (await companyForAddress(message.from))?.name ?? message.from;

    for (const n of notices) {
      const hit = await affected(n, await candidatesFor(n));
      const target = n.course ? `${n.university} — ${n.course}` : n.university;
      lines.push(`📢 Notice from ${company}: ${n.summary}`);

      // "Not KCO-approved" against the agency's own list: hold, change nothing.
      const listed = n.kcoApproval && (n.kind === 'closed' || n.kind === 'paused') ? await approvedRowsFor(n.university, n.course) : [];
      const held = listed.length > 0;
      const heldText = `${company} says ${target} is not KCO-approved, but your Approved Universities list shows it as approved (${listed[0] ?? ''}). Nothing was changed — please confirm with the KCO.`;

      const toReject: ApplicationStatus[] =
        n.kind === 'closed' || n.kind === 'paused'
          ? n.scope === 'all'
            ? ['Pending', 'Missing Items', 'Submitted']
            : ['Pending', 'Missing Items']
          : [];

      const touched: string[] = [];
      for (const c of hit) {
        if (c.app.status === 'Rejected') continue;
        // Accepted is never changed by an email — but an offer for a course that has just
        // been closed or found not KCO-approved is exactly what someone needs to look at.
        const reject = !held && c.app.status !== 'Accepted' && toReject.includes(c.app.status);
        const what = held
          ? `${c.app.university} (${c.app.status}) — held, the list says approved`
          : reject
            ? `${c.app.university} → Rejected`
            : `${c.app.university} (${c.app.status}) — noted${c.app.status === 'Accepted' ? ', please check' : ''}`;
        touched.push(`${c.studentName}: ${what}`);
        if (opts.dryRun) continue;

        if (reject) {
          const result = await updateApplicationStatus(
            c.studentId,
            c.app.university,
            c.app.major,
            'Rejected',
            c.studentName,
            c.employeeId,
            `${company}: ${n.summary}`.slice(0, 200),
          );
          if (result.success) {
            await logAiAction({
              source: 'notice',
              summary: `${c.app.university}: ${c.app.status} → Rejected (notice from ${company})`,
              reason: `${n.summary} — "${n.evidence}"`,
              studentId: c.studentId,
              studentName: c.studentName,
              undo: { type: 'app_status', university: c.app.university, major: c.app.major, from: c.app.status, to: 'Rejected', rejectionReason: c.app.rejectionReason ?? null },
            });
          }
        }
        await db()
          .collection('students')
          .doc(c.studentId)
          .update({
            adminNotes: FieldValue.arrayUnion({
              id: `note-notice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              authorId: 'email-intake',
              content: held
                ? `Notice from ${company} (${message.date.slice(0, 10)}): ${heldText} "${n.evidence}"`
                : `Notice from ${company} (${message.date.slice(0, 10)}): ${n.summary}${reject ? ' — this application set to Rejected.' : ''} "${n.evidence}"`,
              createdAt: new Date().toISOString(),
            }),
          });
        await ensureChatBotUser();
        await sendChatMessage(
          c.studentId,
          CHAT_BOT_USER_ID,
          held
            ? `⚠️ ${heldText}\nThis concerns ${c.app.university} (${c.app.status}).`
            : `📢 ${company}: ${n.summary}\n${reject ? `${c.app.university} has been set to Rejected — it can no longer be submitted.` : `This may affect ${c.app.university} (${c.app.status}); please check.`}`,
          ['admins', 'departments'],
        ).catch(() => undefined);
      }

      let catalogue: string[] = [];
      if (held) lines.push(`   ⚠️ Not applied: ${heldText}`);
      if (!held && !opts.dryRun && (n.kind === 'closed' || n.kind === 'paused' || n.kind === 'reopened')) {
        catalogue = await updateApprovedUniversities(n, n.kind === 'reopened');
      }

      lines.push(
        touched.length
          ? `   Affected students (${touched.length}): ${touched.join('; ')}`
          : `   No open application matches ${target}.`,
      );
      if (catalogue.length) {
        lines.push(`   Approved Universities marked ${n.kind === 'reopened' ? 'open' : 'closed'}: ${catalogue.join('; ')}`);
      }

      if (!opts.dryRun) {
        await db().collection(NOTICE_COLLECTION).add({
          company,
          from: message.from,
          subject: message.subject,
          messageId: message.messageId,
          date: message.date,
          ...n,
          affected: touched,
          approvedUniversitiesChanged: catalogue,
          heldForKcoCheck: held,
          recordedAt: new Date().toISOString(),
        });
      }
    }
    return lines;
  } catch (e) {
    console.error('[email-notices] failed:', e);
    return [];
  }
}
