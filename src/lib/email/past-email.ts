// Applying an email the intake never handled — the offers and rejections in the history
// loaded on 2026-10-03 reached the email memory, but not the profile.
//
// The email is read again from Gmail (All Mail, read-only) and handled as the intake would
// have handled it: its attachments are filed, and an offer or a rejection in it is applied
// to the applications under the same rules. Used by the follow-ups (an offer already in
// the emails is never chased) and by Masar AI when staff ask for it in the chat.

import { adminDb } from '@/lib/firebase/admin';
import { uploadStudentDocument } from '@/lib/documents/upload';
import { logAiAction } from '@/lib/ai/action-log';
import { fetchMessageById } from './inbox';
import { EMAIL_MEMORY_COLLECTION, type EmailMemoryEntry } from './memory';
import { nameDocument } from './name-document';
import { getIntakeSettings } from './intake-settings';
import { emailDocumentNote } from './requests';
import { statusChangeLines, updateApplicationsFromEmail, type StatusChange } from './application-status';
import { EMAIL_INTAKE_USER_ID } from './intake';

export type PastEmailResult =
  | {
      ok: true;
      email: { date: string; from: string; subject: string };
      /** Attachments now on the profile ("… (already on file)" when they were). */
      filed: string[];
      changes: StatusChange[];
      alreadyCorrect: string[];
      lines: string[];
    }
  | { ok: false; error: string };

/**
 * Apply one of a student's remembered emails to their profile. `ref` names the email (its
 * email-memory entry), and must belong to this student. Never throws.
 */
export async function applyPastEmail(input: {
  studentId: string;
  ref: string;
  /** Who asked, for AI Activity. */
  by: string;
  /**
   * Staff asked for this email to be applied: everything in it counts — an application
   * received, a school not yet on the list. Otherwise (the follow-ups) only an offer or a
   * rejection, as the rest of an old email's news may be long past.
   */
  staffAsked?: boolean;
  dryRun?: boolean;
}): Promise<PastEmailResult> {
  if (!adminDb) return { ok: false, error: 'Database not available.' };
  try {
    const entry = (await adminDb.collection(EMAIL_MEMORY_COLLECTION).doc(String(input.ref)).get()).data() as
      | EmailMemoryEntry
      | undefined;
    if (!entry || entry.studentId !== input.studentId) return { ok: false, error: "That email is not in this student's email history." };
    if (!entry.messageId) return { ok: false, error: 'That email cannot be found in Gmail (no Message-ID).' };
    const message = await fetchMessageById(entry.messageId);
    if (!message) return { ok: false, error: 'That email was not found in Gmail.' };
    const email = { date: message.date.slice(0, 10), from: message.fromName || message.from, subject: message.subject };

    const filed: string[] = [];
    if (!input.dryRun && message.attachments.length) {
      const settings = await getIntakeSettings();
      for (const att of message.attachments) {
        const named = settings.aiRenameDocuments
          ? await nameDocument({ filename: att.filename, contentType: att.contentType, subject: message.subject, body: message.text })
          : { name: att.filename.replace(/\.[^.]+$/, '') };
        const upload = await uploadStudentDocument({
          studentId: input.studentId,
          filename: att.filename,
          customName: named.name,
          content: att.content,
          contentType: att.contentType,
          note: emailDocumentNote(message.from, message.subject),
          section: 'admin',
          uploaderId: EMAIL_INTAKE_USER_ID,
          skipIfDuplicate: true,
          notify: true,
        });
        if (!upload.success) return { ok: false, error: `Could not file ${att.filename}: ${upload.error}` };
        filed.push('skipped' in upload ? `${named.name} (already on file)` : named.name);
      }
      const added = filed.filter((f) => !f.endsWith('(already on file)'));
      if (added.length) {
        await logAiAction({
          source: 'email',
          summary: `Filed from an earlier email: ${added.join(' · ')}`,
          reason: `Email from ${email.from} on ${email.date}, "${email.subject}" — asked by ${input.by}`,
          studentId: input.studentId,
          studentName: entry.studentName ?? null,
          undo: { type: 'none' },
        });
      }
    } else if (input.dryRun) {
      filed.push(...message.attachments.map((a) => `${a.filename} (would be filed)`));
    }

    const status = await updateApplicationsFromEmail({ message, studentId: input.studentId, dryRun: input.dryRun, pastEmail: !input.staffAsked });
    return {
      ok: true,
      email,
      filed,
      changes: status.changes,
      alreadyCorrect: status.alreadyCorrect,
      lines: statusChangeLines(status),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
