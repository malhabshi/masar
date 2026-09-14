// Email document intake.
//
// Pulls unread messages that carry attachments, works out which student each belongs to
// by full name, and either files the attachment onto that student's profile or parks it
// in a review queue for a human.
//
// The rule is deliberately strict: a document is filed automatically ONLY when exactly
// one student's complete registered name appears in the email. Nothing is ever guessed
// between two people — a passport on the wrong profile is a quiet, expensive error.

import { adminDb, storage } from '@/lib/firebase/admin';
import { uploadStudentDocument } from '@/lib/documents/upload';
import {
  fetchUnreadWithAttachments,
  isInboxConfigured,
  markMessageSeen,
  type InboxAttachment,
  type InboxMessage,
} from './inbox';
import { loadStudentNames, matchStudentByName } from './matcher';

export const INTAKE_QUEUE_COLLECTION = 'email_intake_queue';
export const INTAKE_LOG_COLLECTION = 'email_intake_log';

/** Uploader id recorded against documents filed from email. */
export const EMAIL_INTAKE_USER_ID = 'email-intake';

export type IntakeItemStatus = 'filed' | 'pending_review' | 'failed';

export type IntakeResult = {
  processed: number;
  filed: number;
  queued: number;
  failed: number;
  skipped: number;
  items: Array<{
    subject: string;
    from: string;
    status: IntakeItemStatus;
    reason?: string;
    studentId?: string;
    studentName?: string;
    attachments: string[];
  }>;
};

/**
 * Park an attachment in Storage so a reviewer can open it later without us having
 * re-read the mailbox. Returns a signed URL.
 */
async function stashAttachment(att: InboxAttachment, key: string): Promise<string | null> {
  if (!storage) return null;
  try {
    const safe = att.filename.replace(/[^\w.\-() ]/g, '_').slice(0, 150) || 'attachment';
    const path = `email_intake/${key}/${Date.now()}_${safe}`;
    const blob = storage.bucket().file(path);
    await blob.save(att.content, { metadata: { contentType: att.contentType } });
    const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });
    return url;
  } catch (e) {
    console.error('[email-intake] Failed to stash attachment:', e);
    return null;
  }
}

async function queueForReview(
  message: InboxMessage,
  reason: string,
  candidates: Array<{ id: string; name: string }>,
): Promise<void> {
  if (!adminDb) return;
  const key = `${message.uid}-${Date.now()}`;
  const stashed = await Promise.all(
    message.attachments.map(async (att) => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      url: await stashAttachment(att, key),
    })),
  );

  await adminDb.collection(INTAKE_QUEUE_COLLECTION).add({
    status: 'pending',
    reason,
    uid: message.uid,
    messageId: message.messageId,
    from: message.from,
    fromName: message.fromName,
    subject: message.subject,
    receivedAt: message.date,
    bodyPreview: message.text.slice(0, 1500),
    attachments: stashed,
    candidates,
    createdAt: new Date().toISOString(),
  });
}

async function log(entry: Record<string, unknown>): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection(INTAKE_LOG_COLLECTION).add({ ...entry, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('[email-intake] Failed to write intake log:', e);
  }
}

/**
 * Run one intake pass. Never throws — returns a summary of what happened.
 */
export async function runEmailIntake(options: { limit?: number } = {}): Promise<IntakeResult> {
  const result: IntakeResult = { processed: 0, filed: 0, queued: 0, failed: 0, skipped: 0, items: [] };

  if (!isInboxConfigured()) {
    await log({ status: 'skipped', reason: 'inbox not configured' });
    return result;
  }

  let messages: InboxMessage[];
  try {
    messages = await fetchUnreadWithAttachments(options.limit ?? 20);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await log({ status: 'error', reason });
    result.failed++;
    result.items.push({ subject: '(inbox)', from: '', status: 'failed', reason, attachments: [] });
    return result;
  }

  if (messages.length === 0) return result;

  const students = await loadStudentNames();

  for (const message of messages) {
    result.processed++;
    const attachmentNames = message.attachments.map((a) => a.filename);

    // Search the sender's display name, the subject and the body together.
    const searchText = [message.fromName, message.subject, message.text].filter(Boolean).join(' \n ');
    const match = matchStudentByName(searchText, students);

    if (match.kind !== 'matched') {
      const reason =
        match.kind === 'ambiguous'
          ? `Name matched ${match.candidates.length} students — needs a human to choose.`
          : 'No student name found in the email.';
      const candidates = match.kind === 'ambiguous'
        ? match.candidates.map((c) => ({ id: c.id, name: c.name }))
        : [];
      await queueForReview(message, reason, candidates);
      await markMessageSeen(message.uid).catch(() => {});
      result.queued++;
      result.items.push({
        subject: message.subject,
        from: message.from,
        status: 'pending_review',
        reason,
        attachments: attachmentNames,
      });
      continue;
    }

    // Exactly one student — file every attachment onto their profile.
    let allOk = true;
    let lastError: string | undefined;
    for (const att of message.attachments) {
      const upload = await uploadStudentDocument({
        studentId: match.student.id,
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
        note: `Received by email from ${message.from} — "${message.subject}"`,
        section: 'admin',
        uploaderId: EMAIL_INTAKE_USER_ID,
        notify: true,
      });
      if (!upload.success) {
        allOk = false;
        lastError = upload.error;
      }
    }

    if (allOk) {
      await markMessageSeen(message.uid).catch(() => {});
      result.filed++;
      result.items.push({
        subject: message.subject,
        from: message.from,
        status: 'filed',
        studentId: match.student.id,
        studentName: match.student.name,
        attachments: attachmentNames,
      });
      await log({
        status: 'filed',
        studentId: match.student.id,
        studentName: match.student.name,
        from: message.from,
        subject: message.subject,
        attachments: attachmentNames,
      });
    } else {
      // Upload failed: leave the message unread so the next run retries it.
      result.failed++;
      result.items.push({
        subject: message.subject,
        from: message.from,
        status: 'failed',
        reason: lastError,
        studentId: match.student.id,
        studentName: match.student.name,
        attachments: attachmentNames,
      });
      await log({
        status: 'failed',
        studentId: match.student.id,
        from: message.from,
        subject: message.subject,
        reason: lastError,
      });
    }
  }

  return result;
}

/** Resolve one queued item by filing its attachments onto a chosen student. */
export async function resolveQueuedItem(
  queueItemId: string,
  studentId: string,
  reviewerId: string,
): Promise<{ success: boolean; filed?: number; error?: string }> {
  if (!adminDb) return { success: false, error: 'Database not available' };

  const ref = adminDb.collection(INTAKE_QUEUE_COLLECTION).doc(queueItemId);
  const snap = await ref.get();
  if (!snap.exists) return { success: false, error: 'Queue item not found.' };

  const item = snap.data() as {
    status?: string;
    subject?: string;
    from?: string;
    attachments?: Array<{ filename: string; contentType: string; url: string | null }>;
  };
  if (item.status === 'resolved') return { success: false, error: 'Already resolved.' };

  const attachments = item.attachments ?? [];
  let filed = 0;

  for (const att of attachments) {
    if (!att.url) continue;
    let buffer: Buffer;
    try {
      const res = await fetch(att.url);
      if (!res.ok) throw new Error(`fetch failed (${res.status})`);
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      return { success: false, error: `Could not read stored attachment: ${e instanceof Error ? e.message : String(e)}` };
    }

    const upload = await uploadStudentDocument({
      studentId,
      filename: att.filename,
      content: buffer,
      contentType: att.contentType,
      note: `Received by email from ${item.from ?? 'unknown'} — "${item.subject ?? ''}" (filed manually)`,
      section: 'admin',
      uploaderId: reviewerId,
      notify: true,
    });
    if (!upload.success) return { success: false, error: upload.error };
    filed++;
  }

  await ref.update({
    status: 'resolved',
    resolvedStudentId: studentId,
    resolvedBy: reviewerId,
    resolvedAt: new Date().toISOString(),
  });

  return { success: true, filed };
}

/** Discard a queued item without filing it (spam, irrelevant, duplicate). */
export async function dismissQueuedItem(queueItemId: string, reviewerId: string, reason?: string) {
  if (!adminDb) return { success: false, error: 'Database not available' };
  await adminDb.collection(INTAKE_QUEUE_COLLECTION).doc(queueItemId).update({
    status: 'dismissed',
    dismissedBy: reviewerId,
    dismissedAt: new Date().toISOString(),
    dismissReason: reason ?? null,
  });
  return { success: true };
}
