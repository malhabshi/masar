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

const SUMMARY_SYSTEM = `You summarise incoming student emails for a study-abroad agency's internal staff chat.

Write ONE short line — at most 25 words — saying what the student is telling us or asking for. This goes into a busy work chat, so:
- No greeting, no sign-off, no "the student says that".
- Lead with the substance: what changed, or what they need.
- If they are asking for something, make the ask explicit.
- If the email is purely a document with no message, say what the document appears to be.
- Never invent detail that is not in the email.
- Reply in the language the email was written in (English or Arabic).`;

/** One short line describing the email. Falls back to a plain excerpt without AI. */
async function summarise(subject: string, body: string): Promise<string> {
  const excerpt = body.replace(/\s+/g, ' ').trim();
  if (!isAiConfigured()) return excerpt.slice(0, 200) || subject || '(no message body)';

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 200,
      system: SUMMARY_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Subject: ${subject}\n\nBody:\n${excerpt.slice(0, 4000)}`,
        },
      ],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim();
    return text || excerpt.slice(0, 200);
  } catch (e) {
    console.error('[email-intake] Summary failed, falling back to excerpt:', e);
    return excerpt.slice(0, 200) || subject || '(no message body)';
  }
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
    const sender = input.fromName ? `${input.fromName} <${input.from}>` : input.from;

    const lines = [
      `📧 Email received from ${sender}`,
      input.subject ? `Subject: ${input.subject}` : '',
      '',
      summary,
    ];
    if (input.filedAttachments.length) {
      lines.push(
        '',
        `📎 Attached to this profile: ${input.filedAttachments.join(', ')}`,
      );
    }
    // Version warnings go last so they are the final thing read — a reissued offer with
    // changed conditions is the most consequential thing in the message.
    if (input.versionNotes?.length) {
      lines.push('', ...input.versionNotes);
    }
    const content = lines.filter((l) => l !== undefined).join('\n').trim();

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
