// Reading the inbox over IMAP.
//
// Gmail accepts the same App Password used for SMTP sending, on imap.gmail.com:993.
// IMAP must also be enabled in Gmail settings (Settings → Forwarding and POP/IMAP), and
// a Workspace admin can disable it org-wide.
//
// ────────────────────────────────────────────────────────────────────────────
// THIS MODULE NEVER DELETES EMAIL.
// There is no delete, expunge, or move anywhere in this file. Handled mail is
// LABELLED, using an IMAP copy — in Gmail, copying to a folder adds that label and
// leaves the message in the inbox. A *move* would remove the INBOX label (archiving
// it), so copy is used deliberately and must not be swapped for move.
// ────────────────────────────────────────────────────────────────────────────
//
// Read/unread is left alone for staff to use as their own to-do signal. Duplicate
// processing is prevented by a Message-ID claim in Firestore, not by the read flag.
//
// Reading is two-phase so that leaving mail unread stays cheap: envelopes first
// (a few hundred bytes each), then the full message only for those not yet handled.

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
  /** Where a reply should go when the sender set Reply-To; otherwise null (use `from`). */
  replyTo?: string | null;
  replyToName?: string | null;
  /** Message-IDs of the earlier messages in this conversation, for threading a reply. */
  references?: string[];
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

/** Gmail labels applied to handled mail. Folders are created on first use. */
export const INTAKE_LABELS = {
  filed: 'masar/filed',
  review: 'masar/review',
  noAction: 'masar/no-action',
} as const;

export type MessageHeader = {
  uid: number;
  messageId: string | null;
  from: string;
  fromName: string;
  subject: string;
  date: string;
};

/**
 * Cheap first pass: envelopes only, for every unread message.
 *
 * Used to decide what is worth downloading in full. Mail stays unread, so this list
 * repeats each run — which is exactly why the expensive fetch is deferred.
 */
export async function fetchUnreadHeaders(limit = 50): Promise<MessageHeader[]> {
  const config = imapConfig();
  if (!config) throw new Error('Inbox is not configured (SMTP_USER / SMTP_PASSWORD).');

  const client = new ImapFlow(config);
  const out: MessageHeader[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search({ seen: false }, { uid: true });
      if (!uids || uids.length === 0) return [];
      const selected = uids.slice(-limit).reverse();

      for await (const msg of client.fetch(
        selected.join(','),
        { envelope: true },
        { uid: true },
      )) {
        const addr = msg.envelope?.from?.[0];
        out.push({
          uid: msg.uid,
          messageId: msg.envelope?.messageId ?? null,
          from: addr?.address ?? '',
          fromName: addr?.name ?? '',
          subject: msg.envelope?.subject ?? '',
          date: new Date(msg.envelope?.date ?? Date.now()).toISOString(),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return out;
}

/** Download and parse one message in full, including attachments. */
export async function fetchMessageByUid(uid: number): Promise<InboxMessage | null> {
  const config = imapConfig();
  if (!config) throw new Error('Inbox is not configured.');

  const client = new ImapFlow(config);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const item = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!item || !item.source) return null;

      const parsed = await simpleParser(item.source);
      const attachments: InboxAttachment[] = [];
      for (const att of parsed.attachments ?? []) {
        const contentType = String(att.contentType ?? '').toLowerCase();
        if (!ALLOWED_CONTENT_TYPES.has(contentType)) continue;
        if (!att.content || att.size > MAX_ATTACHMENT_BYTES) continue;
        if (att.contentDisposition === 'inline' && contentType.startsWith('image/')) continue;
        attachments.push({
          filename: att.filename || `attachment-${attachments.length + 1}`,
          contentType,
          size: att.size,
          content: att.content as Buffer,
        });
      }

      const fromAddr = parsed.from?.value?.[0];
      const replyAddr = parsed.replyTo?.value?.[0];
      const refs = parsed.references;
      return {
        uid,
        messageId: parsed.messageId ?? null,
        from: fromAddr?.address ?? '',
        fromName: fromAddr?.name ?? '',
        subject: parsed.subject ?? '',
        date: (parsed.date ?? new Date()).toISOString(),
        replyTo: replyAddr?.address ?? null,
        replyToName: replyAddr?.name ?? null,
        references: Array.isArray(refs) ? refs : refs ? [refs] : [],
        text: parsed.text ?? (parsed.html ? String(parsed.html).replace(/<[^>]+>/g, ' ') : ''),
        attachments,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Apply a Gmail label to a message, leaving it in the inbox and leaving its read state
 * untouched.
 *
 * Uses COPY, not MOVE. In Gmail's IMAP model a copy adds the destination label while
 * keeping INBOX; a move would strip INBOX and archive the mail. Nothing here deletes.
 */
export async function applyLabel(uid: number, label: string): Promise<boolean> {
  const config = imapConfig();
  if (!config) return false;
  const client = new ImapFlow(config);
  try {
    await client.connect();
    // Creating an existing mailbox throws; that is fine and means it already exists.
    await client.mailboxCreate(label).catch(() => {});
    const lock = await client.getMailboxLock('INBOX');
    try {
      await client.messageCopy(String(uid), label, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error(`[inbox] Could not label uid ${uid} as "${label}":`, e);
    return false;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Place a message into the mailbox directly, already marked read.
 *
 * Used for our own filing receipts. Sending them over SMTP works, but they then arrive
 * back as UNREAD mail and inflate the unread count until a later run notices and marks
 * them — and unread is the signal staff rely on. Appending with \Seen puts the receipt in
 * the conversation immediately without ever touching that count.
 */
export async function appendSeenMessage(raw: Buffer | string): Promise<boolean> {
  const config = imapConfig();
  if (!config) return false;
  const client = new ImapFlow(config);
  try {
    await client.connect();
    const res = await client.append('INBOX', raw, ['\\Seen']);
    return Boolean(res);
  } catch (e) {
    console.error('[inbox] Could not append receipt:', e);
    return false;
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Save a message as a DRAFT in the mailbox. It is never sent — it waits in Drafts until
 * someone opens Gmail and presses Send. Gmail threads it under the original email from
 * its In-Reply-To / References headers.
 *
 * The Drafts folder is found by its special-use flag, because Gmail localises its name
 * ("[Gmail]/Drafts", "[Gmail]/المسودات"…).
 */
export async function appendDraft(raw: Buffer | string): Promise<{ ok: boolean; folder?: string; error?: string }> {
  const config = imapConfig();
  if (!config) return { ok: false, error: 'Inbox is not configured.' };
  const client = new ImapFlow(config);
  try {
    await client.connect();
    const boxes = await client.list();
    const drafts = boxes.find((b) => b.specialUse === '\\Drafts')?.path ?? '[Gmail]/Drafts';
    const res = await client.append(drafts, raw, ['\\Draft', '\\Seen']);
    return res ? { ok: true, folder: drafts } : { ok: false, error: 'The mailbox did not accept the draft.' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Fetch unread messages in full.
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
      // `{ uid: true }` is essential: without it ImapFlow returns SEQUENCE numbers, which
      // are positional and shift as the mailbox changes. Marking a message read by a
      // sequence number flags the wrong message, so mail is re-processed forever.
      const uids = await client.search({ seen: false }, { uid: true });
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

        // Never process our own mail. The filing receipts we send are addressed to this
        // same mailbox and quote the student's full name, so without this guard every
        // receipt would be read back, matched to that student, and announced in chat —
        // which would then generate another receipt.
        const self = (config.auth.user ?? '').toLowerCase();
        if (self && (fromAddr?.address ?? '').toLowerCase() === self) {
          await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true }).catch(() => {});
          continue;
        }

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

/**
 * Mark a message read so the next run skips it.
 *
 * Returns whether the flag was actually applied. A silent failure here means the message
 * is processed again on the next run — which is how duplicate documents get filed — so
 * the caller must not ignore a false.
 */
export async function markMessageSeen(uid: number): Promise<boolean> {
  const config = imapConfig();
  if (!config) return false;
  const client = new ImapFlow(config);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const ok = await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      if (!ok) console.error(`[inbox] Could not mark uid ${uid} as seen.`);
      return Boolean(ok);
    } finally {
      lock.release();
    }
  } catch (e) {
    console.error(`[inbox] Failed to mark uid ${uid} as seen:`, e);
    return false;
  } finally {
    await client.logout().catch(() => {});
  }
}
