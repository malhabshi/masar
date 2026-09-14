// Announcing an incoming email in the student's internal staff chat.
//
// Recipients are resolved so the right people actually get a notification:
//   - the assigned employee   (student.employeeId is a CIVIL ID, so it needs a lookup)
//   - 'admins'                (every admin user)
//   - 'departments'           (department users whose department matches the student's
//                              application countries — a UK applicant reaches UK, an
//                              Australian one reaches AU/NZ; resolved inside sendChatMessage)

import Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/firebase/admin';
import { sendChatMessage } from '@/lib/actions';
import { CHAT_BOT_USER_ID, ensureChatBotUser } from '@/lib/ai/chat-bot';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_MODEL, isAiConfigured } from '@/lib/ai/config';

/** Look up the user id of the employee assigned to a student, given their civil ID. */
export async function findEmployeeUserIdByCivilId(civilId?: string | null): Promise<string | null> {
  if (!adminDb || !civilId) return null;
  try {
    const snap = await adminDb.collection('users').where('civilId', '==', civilId).limit(1).get();
    return snap.empty ? null : snap.docs[0].id;
  } catch {
    return null;
  }
}

const SUMMARY_SYSTEM = `You summarise incoming student emails for a Kuwaiti study-abroad agency's internal staff chat. Staff are busy and read on their phones, so every word must earn its place.

Say ONLY the thing that matters: what is needed, what changed, or what was decided.

Cut all of this:
- greetings, sign-offs, pleasantries, "please find attached"
- reference numbers, application IDs, case numbers
- the sender's name and company (staff can already see who it is from)
- anything that does not change what someone has to do

ALWAYS identify the university or college the email concerns. A student usually has
several applications running at once, and different universities send near-identical
requests — staff cannot act without knowing which one this is about.

Rules:
- At most 25 words in English.
- If something is REQUIRED from us or the student, lead with it and name the deadline if there is one.
- If the email is only a document with no message, say what the document is.
- Never invent detail that is not in the email.

Reply with EXACTLY three lines and nothing else:
UNI: <the university or college name ALONE - no agency name, no parenthetical, no campus code. Use NONE only if it genuinely concerns no institution.>
EN: <the English line>
AR: <the same thing in Arabic>

The Arabic must be natural Kuwaiti-office Arabic, not a literal word-for-word translation.`;

export type EmailSummary = { en: string; ar: string | null; university: string | null };

/** The one important line, in English and Arabic. Falls back to an excerpt without AI. */
async function summarise(subject: string, body: string): Promise<EmailSummary> {
  const excerpt = body.replace(/\s+/g, ' ').trim();
  const fallback = { en: excerpt.slice(0, 200) || subject || '(no message body)', ar: null, university: null };
  if (!isAiConfigured()) return fallback;

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 400,
      system: SUMMARY_SYSTEM,
      messages: [
        { role: 'user', content: `Subject: ${subject}\n\nBody:\n${excerpt.slice(0, 4000)}` },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    const en = text.match(/^EN:\s*(.+)$/m)?.[1]?.trim();
    const ar = text.match(/^AR:\s*(.+)$/m)?.[1]?.trim();
    const uni = text.match(/^UNI:\s*(.+)$/m)?.[1]?.trim();
    if (!en) return fallback;
    return {
      en,
      ar: ar || null,
      university: uni && !/^NONE$/i.test(uni) ? uni : null,
    };
  } catch (e) {
    console.error('[email-intake] Summary failed, falling back to excerpt:', e);
    return fallback;
  }
}

/**
 * Header line: university first, sender second. The sender is dropped when the
 * university string already names them ("University of Bath (Study Group)" alongside
 * "Study Group Admissions" reads as a stutter).
 */
function buildHeader(university: string | null, sender: string): string {
  if (!university) return `📧 ${sender}`;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const uni = norm(university);
  // Significant words from the sender, ignoring generic ones.
  const senderWords = norm(sender)
    .split(' ')
    .filter((w) => w.length > 3 && !['admissions', 'admission', 'team', 'office', 'group'].includes(w));
  const alreadyNamed = senderWords.length > 0 && senderWords.every((w) => uni.includes(w));
  return alreadyNamed ? `📧 ${university}` : `📧 ${university} · ${sender}`;
}

export type ChatAnnouncement = {
  studentId: string;
  employeeCivilId?: string | null;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  /** Filenames successfully attached to the profile, if any. */
  filedAttachments: string[];
  /** Warnings about a document superseding one already on file. */
  versionNotes?: string[];
};

/**
 * Build the chat message without posting it — used to preview wording changes against
 * real emails before they reach anyone's chat.
 */
export async function buildChatMessagePreview(input: {
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  filedAttachments: string[];
  versionNotes?: string[];
}): Promise<string> {
  const summary = await summarise(input.subject, input.body);
  const sender = input.fromName || input.from.split('@')[1] || input.from;
  const header = buildHeader(summary.university, sender);
  const lines: string[] = [header, '', summary.en];
  if (summary.ar) lines.push('', summary.ar);
  if (input.filedAttachments.length) lines.push('', `📎 ${input.filedAttachments.join(' · ')}`);
  if (input.versionNotes?.length) lines.push('', ...input.versionNotes);
  return lines.join('\n').trim();
}

export type ChatAnnouncementResult = {
  posted: boolean;
  error?: string;
  recipients?: string[];
  content?: string;
};

/**
 * Post an "email received" note into the student's internal chat, mentioning the
 * assigned employee, all admins, and the relevant department.
 */
export async function announceEmailInChat(
  input: ChatAnnouncement,
): Promise<ChatAnnouncementResult> {
  try {
    await ensureChatBotUser();

    const summary = await summarise(input.subject, input.body);

    // Just the organisation, not "Email received from Name <address>" plus a subject
    // line — staff can open the email for that. The point of the message is the ask.
    const sender = input.fromName || input.from.split('@')[1] || input.from;
    // The university matters more than the sender: a student has several applications
    // running and different universities send near-identical requests.
    const header = buildHeader(summary.university, sender);

    const lines: string[] = [header, '', summary.en];
    if (summary.ar) lines.push('', summary.ar);

    if (input.filedAttachments.length) {
      lines.push('', `📎 ${input.filedAttachments.join(' · ')}`);
    }
    // Version warnings go last so they are the final thing read — a reissued offer with
    // changed conditions is the most consequential thing in the message.
    if (input.versionNotes?.length) {
      lines.push('', ...input.versionNotes);
    }
    const content = lines.join('\n').trim();

    // Assigned employee + all admins + the student's own department(s).
    const employeeUserId = await findEmployeeUserIdByCivilId(input.employeeCivilId);
    const recipientIds = [
      ...(employeeUserId ? [employeeUserId] : []),
      'admins',
      'departments',
    ];

    const result = await sendChatMessage(input.studentId, CHAT_BOT_USER_ID, content, recipientIds);
    if (!result.success) return { posted: false, error: result.message, content };

    return { posted: true, recipients: recipientIds, content };
  } catch (e) {
    return { posted: false, error: e instanceof Error ? e.message : String(e) };
  }
}
