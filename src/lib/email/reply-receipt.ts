// Replying in-thread with what was done.
//
// The reply is addressed ONLY to the mailbox we read from, never to the original sender —
// an admissions office should not receive our internal filing notes. Because it lands in
// the same Gmail conversation (via In-Reply-To / References), opening the thread shows
// what the system did with that email, right underneath it.

import nodemailer from 'nodemailer';
import { appendSeenMessage } from './inbox';
import type { InboxMessage } from './inbox';

export type ReceiptOutcome =
  | {
      kind: 'filed';
      studentId: string;
      studentName: string;
      documents: string[];
      versionNotes: string[];
      requestNotes?: string[];
      /** Application statuses changed (or held back) because of this email. */
      statusNotes?: string[];
      /** Company-wide notices found in this email and who they affected. */
      notices?: string[];
      chatPosted: boolean;
      chatRecipients: string[];
    }
  | {
      /** A reply to this email was saved in Drafts, with what was asked for attached. */
      kind: 'drafted';
      studentId: string;
      studentName: string;
      to: string;
      answered: string[];
      attachments: string[];
      stillWaiting: string[];
    }
  | { kind: 'queued'; reason: string; attachments: string[]; notices?: string[] }
  | { kind: 'skipped'; reason: string; notices?: string[] }
  | { kind: 'failed'; reason: string; studentName?: string };

function profileUrl(studentId: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/student/${studentId}` : `(profile id: ${studentId})`;
}

function buildBody(message: InboxMessage, outcome: ReceiptOutcome): { subject: string; text: string } {
  const header = [
    'Masar — automatic filing report',
    '',
    `Original email : "${message.subject || '(no subject)'}"`,
    `From           : ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
    `Received       : ${new Date(message.date).toLocaleString()}`,
    `Attachments    : ${message.attachments.length ? message.attachments.map((a) => a.filename).join(', ') : 'none'}`,
    '',
    '----------------------------------------',
    '',
  ];

  const lines: string[] = [];
  let subject: string;

  switch (outcome.kind) {
    case 'filed': {
      const changed = (outcome.statusNotes ?? []).filter((l) => l.startsWith('🎓'));
      subject =
        `✅ Filed to ${outcome.studentName}` +
        (changed.length ? ` · ${changed.map((l) => l.replace(/^🎓\s*/, '').replace(/\s*\(.*\)$/, '')).join(' · ')}` : '');
      lines.push(
        `RESULT: Filed to ${outcome.studentName}`,
        '',
        outcome.documents.length
          ? `Documents added to the profile:\n${outcome.documents.map((d) => `  • ${d}`).join('\n')}`
          : 'No attachments — the update was recorded, nothing was added to the profile.',
      );
      if (outcome.notices?.length) {
        lines.push('', 'COMPANY NOTICE (applied to all students):', ...outcome.notices.map((l) => `  ${l}`));
      }
      if (outcome.statusNotes?.length) {
        lines.push('', 'APPLICATION STATUS:', ...outcome.statusNotes.map((l) => `  ${l}`));
      }
      if (outcome.requestNotes?.length) {
        lines.push('', 'REQUESTS:', ...outcome.requestNotes.map((l) => `  ${l}`));
      }
      if (outcome.versionNotes.length) {
        lines.push(
          '',
          'VERSION CHECK:',
          ...outcome.versionNotes.map((n) => n.replace(/\*/g, '').split('\n').map((l) => `  ${l}`).join('\n')),
        );
      }
      lines.push(
        '',
        outcome.chatPosted
          ? `Posted in the internal chat, notifying: ${outcome.chatRecipients.join(', ')}`
          : 'NOTE: could not post in the internal chat — nobody was notified there.',
        '',
        `Profile: ${profileUrl(outcome.studentId)}`,
      );
      break;
    }
    case 'drafted': {
      subject = `✉️ Reply draft ready — ${outcome.studentName}`;
      lines.push(
        `RESULT: A reply to this email is waiting in Drafts, addressed to ${outcome.to}.`,
        '',
        `Answers: ${outcome.answered.join(' · ')}`,
        outcome.attachments.length ? `Attached: ${outcome.attachments.join(' · ')}` : 'No attachments.',
        outcome.stillWaiting.length ? `Still waiting for: ${outcome.stillWaiting.join(' · ')}` : '',
        '',
        'Check it in Drafts and press Send — nothing has been sent.',
        '',
        `Profile: ${profileUrl(outcome.studentId)}`,
      );
      break;
    }
    case 'queued': {
      subject = '⚠️ Needs review — student not identified';
      lines.push(
        'RESULT: Not filed. Waiting for someone to choose the student.',
        '',
        `Reason: ${outcome.reason}`,
        '',
        'The attachment is safe and can be filed from the Email Documents page.',
        outcome.attachments.length ? `Held: ${outcome.attachments.join(', ')}` : '',
      );
      if (outcome.notices?.length) lines.push('', 'COMPANY NOTICE (applied to all students):', ...outcome.notices.map((l) => `  ${l}`));
      break;
    }
    case 'skipped': {
      subject = outcome.notices?.length ? '📢 Company notice applied' : 'ℹ️ No action taken';
      lines.push(
        outcome.notices?.length ? 'RESULT: No single student — but the email carries news for many.' : 'RESULT: Nothing was filed.',
        '',
        `Reason: ${outcome.reason}`,
      );
      if (outcome.notices?.length) lines.push('', 'COMPANY NOTICE (applied to all students):', ...outcome.notices.map((l) => `  ${l}`));
      break;
    }
    case 'failed': {
      subject = '❌ Filing failed';
      lines.push(
        `RESULT: Could not file${outcome.studentName ? ` to ${outcome.studentName}` : ''}.`,
        '',
        `Error: ${outcome.reason}`,
        '',
        'The email has been left unread so it will be retried automatically.',
      );
      break;
    }
  }

  return {
    subject,
    text: [...header, ...lines.filter((l) => l !== '')].join('\n'),
  };
}

/**
 * Put the filing report into the original email thread. Never throws.
 *
 * The message is BUILT locally and appended straight into the mailbox already marked
 * read — it is never sent over SMTP. Two reasons: it can only ever be for us, so there is
 * nothing to deliver; and a real send would arrive back as unread mail, inflating the
 * unread count that staff use as their to-do list. Threading headers still place it under
 * the original email.
 */
export async function replyWithReceipt(
  message: InboxMessage,
  outcome: ReceiptOutcome,
): Promise<{ sent: boolean; error?: string }> {
  const mailbox = process.env.SMTP_USER?.trim();
  if (!mailbox) return { sent: false, error: 'SMTP_USER is not set.' };

  const { subject, text } = buildBody(message, outcome);

  try {
    // streamTransport + buffer builds the MIME message without opening a connection.
    const builder = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const built = await builder.sendMail({
      from: mailbox,
      to: mailbox,
      subject: `Re: ${message.subject || '(no subject)'} — ${subject}`,
      text,
      ...(message.messageId
        ? { inReplyTo: message.messageId, references: [message.messageId] }
        : {}),
    });

    const raw = built.message as Buffer;
    const ok = await appendSeenMessage(raw);
    return ok ? { sent: true } : { sent: false, error: 'Could not append the receipt to the mailbox.' };
  } catch (e) {
    return { sent: false, error: e instanceof Error ? e.message : String(e) };
  }
}
