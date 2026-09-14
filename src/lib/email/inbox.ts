// Reading the inbox over IMAP.
//
// Gmail accepts the same App Password used for SMTP sending, on imap.gmail.com:993.
// IMAP must also be enabled in Gmail settings (Settings → Forwarding and POP/IMAP), and
// a Workspace admin can disable it org-wide.
//
// Only unread messages that carry at least one usable attachment are returned. Messages
// are NOT marked as read here — that happens after a message has been dealt with, so a
// crash mid-run means the message is retried rather than silently lost.

import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

/** Attachment types worth filing onto a student profile. */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Skip anything larger than this; the upload path caps at 20 MB anyway. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export type InboxAttachment = {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
};

export type InboxMessage = {
  uid: number;
  messageId: string | null;
  from: string;
  fromName: string;
  subject: string;
  date: string;
  /** Plain-text body, or the stripped-down HTML when there is no text part. */
  text: string;
  attachments: InboxAttachment[];
};

function imapConfig() {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!user || !pass) return null;
  return {
    host: process.env.IMAP_HOST?.trim() || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT ?? '993'),
    secure: true,
    auth: { user, pass },
    logger: false as const,
  };
}

export function isInboxConfigured(): boolean {
  return imapConfig() !== null;
}

/** Log in and immediately disconnect. Proves the credentials work without reading mail. */
export async function verifyInboxConnection(): Promise<{ ok: boolean; error?: string }> {
  const config = imapConfig();
  if (!config) return { ok: false, error: 'SMTP_USER and SMTP_PASSWORD must be set.' };
  const client = new ImapFlow(config);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    if (/AUTHENTICATIONFAILED|Invalid credentials/i.test(raw)) {
      return {
        ok: false,
        error:
          'Gmail rejected the IMAP login. Check the App Password, and that IMAP is enabled ' +
          'in Gmail (Settings → Forwarding and POP/IMAP → Enable IMAP).',
      };
    }
    return { ok: false, error: raw };
  }
}

/**
 * Fetch unread messages.
 *
 * `requireAttachments: false` also returns plain text updates — a student writing
 * "my visa was approved" matters as much as one sending a scan.
 */
export async function fetchUnreadMessages(
  limit = 20,
  opts: { requireAttachments?: boolean } = {},
): Promise<InboxMessage[]> {
  const requireAttachments = opts.requireAttachments ?? false;
  const config = imapConfig();
  if (!config) throw new Error('Inbox is not configured (SMTP_USER / SMTP_PASSWORD).');

  const client = new ImapFlow(config);
  const results: InboxMessage[] = [];

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false });
      if (!uids || uids.length === 0) return [];

      // Newest first, bounded so one run can't pull down a huge backlog.
      const selected = uids.slice(-limit).reverse();

      for (const uid of selected) {
        const item = await client.fetchOne(String(uid), { source: true }, { uid: true });
        if (!item || !item.source) continue;

        const parsed = await simpleParser(item.source);
        const attachments: InboxAttachment[] = [];

        for (const att of parsed.attachments ?? []) {
          const contentType = String(att.contentType ?? '').toLowerCase();
          if (!ALLOWED_CONTENT_TYPES.has(contentType)) continue;
          if (!att.content || att.size > MAX_ATTACHMENT_BYTES) continue;
          // Inline images (signatures, logos) are not documents.
          if (att.contentDisposition === 'inline' && contentType.startsWith('image/')) continue;
          attachments.push({
            filename: att.filename || `attachment-${attachments.length + 1}`,
            contentType,
            size: att.size,
            content: att.content as Buffer,
          });
        }

        if (requireAttachments && attachments.length === 0) continue;

        const fromAddr = parsed.from?.value?.[0];
        results.push({
          uid,
          messageId: parsed.messageId ?? null,
          from: fromAddr?.address ?? '',
          fromName: fromAddr?.name ?? '',
          subject: parsed.subject ?? '',
          date: (parsed.date ?? new Date()).toISOString(),
          text: parsed.text ?? (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : ''),
          attachments,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return results;
}

/** Mark a message read so the next run skips it. */
export async function markMessageSeen(uid: number): Promise<void> {
  const config = imapConfig();
  if (!config) return;
  const client = new ImapFlow(config);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}
