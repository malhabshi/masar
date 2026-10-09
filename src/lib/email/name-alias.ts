// Names staff teach the intake by attaching an email to a student.
//
// An email that writes a student's name differently from the profile ("Abdulaziz E Kh E M E
// Alhammadi" for ABDULAZIZ E KH E M ALHMMADI) matches nobody and waits in the review queue.
// When staff attach it to the student, the name as that email writes it is kept, so the
// next email that writes it the same way is filed by itself — the admin, 2026-10-09: "if I
// attached any student to an email, in the future it will always match". The same student
// had been attached by hand three times.
//
// Kept only when it is safe to match on: the name really is in the email; it has three or
// more words, two of them full words (not "Ahmad Alshammari", which fits many students); it
// is not another student's name. A name staff attach to two different students is dropped.
// Each learned name is in AI Activity, where Undo forgets it.

import Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';
import { logAiAction } from '@/lib/ai/action-log';
import { loadStudentNames, matchStudentByName, NAME_ALIASES_COLLECTION, normalizeName } from './matcher';

const SYSTEM = `Staff filed an email under a student of a study-abroad agency. The email writes the student's name in its own way — misspelt, with an extra or missing initial, the names in another order. Give the student's name EXACTLY as this email writes it: the same words, spelling and order, without a title (Mr, Miss) or anything around it (application numbers, school names). Never the sender's name or a staff member's name, and never a corrected spelling. If the email does not write the student's name, give null. Call record_name once.`;

const TOOL: Anthropic.Tool = {
  name: 'record_name',
  description: "The student's name as the email writes it.",
  input_schema: {
    type: 'object',
    properties: { name: { type: ['string', 'null'] } },
    required: ['name'],
  },
};

/** At least three words, two of them three letters or longer. */
function specificEnough(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  return words.length >= 3 && words.filter((w) => w.length >= 3).length >= 2;
}

export type LearnedName = { learned: string } | { skipped: string };

/** Keep the name an email used for the student staff attached it to. Never throws. */
export async function learnNameFromEmail(input: {
  studentId: string;
  fromName?: string | null;
  from?: string | null;
  subject?: string | null;
  body?: string | null;
  by: { id: string; name: string };
  /** Say what would be learned; keep nothing. */
  dryRun?: boolean;
}): Promise<LearnedName> {
  try {
    if (!adminDb) return { skipped: 'no database' };
    if (!isAiConfigured()) return { skipped: 'the AI is not set up' };
    const student = (await adminDb.collection('students').doc(input.studentId).get()).data();
    const profileName = String(student?.name ?? '').trim();
    if (!profileName) return { skipped: 'the student has no name on the profile' };

    const text = [input.fromName, input.subject, input.body].filter(Boolean).join('\n');
    const res = await getAnthropicClient('email-name').messages.create({
      model: AI_FAST_MODEL,
      max_tokens: 100,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_name' },
      messages: [
        {
          role: 'user',
          content: [
            `The student's name on the profile: ${profileName}`,
            '',
            `Subject: ${input.subject ?? ''}`,
            '',
            String(input.body ?? '').slice(0, 3000) || '(no text)',
          ].join('\n'),
        },
      ],
    });
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const written = String((use?.input as { name?: string | null } | undefined)?.name ?? '').trim();
    const normalized = normalizeName(written);
    if (!normalized) return { skipped: 'the email does not write the name' };
    if (!` ${normalizeName(text)} `.includes(` ${normalized} `)) return { skipped: `"${written}" is not in the email` };
    if (normalized === normalizeName(profileName)) return { skipped: 'the email writes the profile name' };
    if (!specificEnough(normalized)) return { skipped: `"${written}" is too short to tell students apart` };

    // Another student's name inside it: such an email would match them too.
    const other = matchStudentByName(written, (await loadStudentNames()).filter((s) => !s.alias));
    if (other.kind === 'matched' && other.student.id !== input.studentId) return { skipped: `"${written}" contains ${other.student.name}'s name` };
    if (other.kind === 'ambiguous') return { skipped: `"${written}" contains other students' names` };

    if (input.dryRun) return { learned: written };
    const ref = adminDb.collection(NAME_ALIASES_COLLECTION).doc(normalized.slice(0, 400));
    const outcome = await adminDb.runTransaction(async (tx) => {
      const prev = (await tx.get(ref)).data();
      if (prev?.conflict === true) return 'conflict' as const;
      if (prev && prev.studentId !== input.studentId) {
        tx.set(ref, { conflict: true, conflictStudentIds: [prev.studentId, input.studentId], conflictAt: new Date().toISOString() }, { merge: true });
        return 'conflict' as const;
      }
      if (prev) return 'known' as const;
      tx.set(ref, {
        alias: written,
        normalized,
        studentId: input.studentId,
        studentName: profileName,
        from: input.from ?? null,
        subject: input.subject ?? null,
        by: input.by.id,
        byName: input.by.name,
        at: new Date().toISOString(),
        conflict: false,
      });
      return 'new' as const;
    });
    if (outcome === 'conflict') return { skipped: `"${written}" was attached to another student before, so it is no longer matched to either` };
    if (outcome === 'known') return { learned: written };

    await logAiAction({
      source: 'email',
      summary: `Name learned: emails that write "${written}" are filed under ${profileName}`,
      reason: `${input.by.name} attached the email "${input.subject ?? ''}" to this student`,
      studentId: input.studentId,
      studentName: profileName,
      undo: { type: 'forget_name', id: ref.id },
    });
    return { learned: written };
  } catch (e) {
    console.error('[name-alias] could not learn the name:', e);
    return { skipped: e instanceof Error ? e.message : String(e) };
  }
}
