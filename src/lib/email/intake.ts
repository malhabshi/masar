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
  fetchUnreadMessages,
  isInboxConfigured,
  markMessageSeen,
  type InboxAttachment,
  type InboxMessage,
} from './inbox';
import { loadStudentNames, matchStudentByName } from './matcher';
import { announceEmailInChat } from './notify-chat';
import { nameDocument } from './name-document';
import { getIntakeSettings } from './intake-settings';
import {
  compareDocumentVersions,
  extractPdfText,
  findSupersededDocument,
} from './document-compare';
import type { Document as StudentDocument } from '@/lib/types';
import { replyWithReceipt } from './reply-receipt';

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
  /** How many were announced in the student's internal chat. */
  notified: number;
  items: Array<{
    subject: string;
    from: string;
    status: IntakeItemStatus;
    reason?: string;
    studentId?: string;
    studentName?: string;
    attachments: string[];
    chatPosted?: boolean;
    chatError?: string;
  }>;
};

/**
 * Claim a message so it can only ever be filed once.
 *
 * Belt and braces alongside the IMAP \Seen flag: if marking read fails for any reason,
 * the next run would otherwise file the same attachments again. Keyed on the RFC822
 * Message-ID, which is stable and unique per email.
 */
async function claimMessage(messageId: string | null, uid: number): Promise<boolean> {
  if (!adminDb) return true; // No DB means no dedupe; better to process than to stall.
  const key = (messageId ?? `uid-${uid}`).replace(/[^\w.@-]/g, '_').slice(0, 400);
  const ref = adminDb.collection('email_intake_seen').doc(key);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) return false;
      tx.set(ref, { messageId, uid, claimedAt: new Date().toISOString() });
      return true;
    });
  } catch (e) {
    console.error('[email-intake] Claim failed:', e);
    return false;
  }
}

/** Documents currently on a student's profile, for version comparison. */
async function getStudentDocuments(studentId: string): Promise<StudentDocument[]> {
  if (!adminDb) return [];
  try {
    const snap = await adminDb.collection('students').doc(studentId).get();
    const docs = snap.data()?.documents;
    return Array.isArray(docs) ? (docs as StudentDocument[]) : [];
  } catch {
    return [];
  }
}

/** Download a stored document and pull its text out, for comparing against a new version. */
async function fetchDocumentText(doc: StudentDocument): Promise<string | null> {
  if (!doc.url) return null;
  try {
    const res = await fetch(doc.url);
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    // Stored offer letters are PDFs; the content type on the signed URL is authoritative.
    return extractPdfText(buffer, type.includes('pdf') ? 'application/pdf' : type);
  } catch (e) {
    console.error('[email-intake] Could not fetch stored document for comparison:', e);
    return null;
  }
}

/** The assigned employee's civil ID, used to notify them specifically. */
async function getStudentEmployeeCivilId(studentId: string): Promise<string | null> {
  if (!adminDb) return null;
  try {
    const snap = await adminDb.collection('students').doc(studentId).get();
    return (snap.data()?.employeeId as string | undefined) ?? null;
  } catch {
    return null;
  }
}

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
  const result: IntakeResult = {
    processed: 0,
    filed: 0,
    queued: 0,
    failed: 0,
    skipped: 0,
    notified: 0,
    items: [],
  };

  if (!isInboxConfigured()) {
    await log({ status: 'skipped', reason: 'inbox not configured' });
    return result;
  }

  let messages: InboxMessage[];
  try {
    // Attachments are not required: a plain text update ("my visa was approved") still
    // needs to reach the employee and the department.
    messages = await fetchUnreadMessages(options.limit ?? 20, { requireAttachments: false });
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await log({ status: 'error', reason });
    result.failed++;
    result.items.push({ subject: '(inbox)', from: '', status: 'failed', reason, attachments: [] });
    return result;
  }

  if (messages.length === 0) return result;

  const settings = await getIntakeSettings();
  const students = await loadStudentNames();

  for (const message of messages) {
    result.processed++;
    const attachmentNames = message.attachments.map((a) => a.filename);

    // Search the sender's display name, the subject and the body together.
    const searchText = [message.fromName, message.subject, message.text].filter(Boolean).join(' \n ');
    const match = matchStudentByName(searchText, students);

    // Test restriction: anything that is not the chosen student is left completely
    // untouched — including its unread flag — so a trial run consumes nothing else.
    if (settings.restrictToStudentId) {
      const isTarget = match.kind === 'matched' && match.student.id === settings.restrictToStudentId;
      if (!isTarget) {
        result.skipped++;
        result.items.push({
          subject: message.subject,
          from: message.from,
          status: 'pending_review',
          reason: `Skipped — test mode is limited to ${settings.restrictToStudentName ?? 'one student'}. Left unread.`,
          attachments: attachmentNames,
        });
        continue;
      }
    }

    // Only claim once we know we are going to act on it — a message skipped by test mode
    // must stay claimable for the real run later.
    if (!(await claimMessage(message.messageId, message.uid))) {
      result.skipped++;
      result.items.push({
        subject: message.subject,
        from: message.from,
        status: 'pending_review',
        reason: 'Already processed in an earlier run — skipped to avoid a duplicate.',
        attachments: attachmentNames,
      });
      await markMessageSeen(message.uid);
      continue;
    }

    if (match.kind !== 'matched') {
      const reason =
        match.kind === 'ambiguous'
          ? `Name matched ${match.candidates.length} students — needs a human to choose.`
          : 'No student name found in the email.';

      // An unidentified email carrying a document must never be dropped. An unidentified
      // email with no attachment is usually a newsletter or spam, so it is logged and
      // marked read rather than filling the review queue.
      if (message.attachments.length === 0) {
        await replyWithReceipt(message, { kind: 'skipped', reason });
        await markMessageSeen(message.uid).catch(() => {});
        result.skipped++;
        await log({ status: 'skipped', reason, from: message.from, subject: message.subject });
        result.items.push({
          subject: message.subject,
          from: message.from,
          status: 'pending_review',
          reason: `${reason} No attachment, so it was skipped rather than queued.`,
          attachments: [],
        });
        continue;
      }

      const candidates = match.kind === 'ambiguous'
        ? match.candidates.map((c) => ({ id: c.id, name: c.name }))
        : [];
      await queueForReview(message, reason, candidates);
      await replyWithReceipt(message, { kind: 'queued', reason, attachments: attachmentNames });
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
    const filedNames: string[] = [];
    const versionNotes: string[] = [];
    const existingDocs = await getStudentDocuments(match.student.id);
    for (const att of message.attachments) {
      // Attachments arrive named "WhatsApp Image 2026-09-01 at 12.12.26 AM.jpeg"; work
      // out what the document actually is. The original filename is kept on the record.
      const named = settings.aiRenameDocuments
        ? await nameDocument({
            filename: att.filename,
            contentType: att.contentType,
            subject: message.subject,
            body: message.text,
          })
        : { name: att.filename.replace(/\.[^.]+$/, ''), source: 'fallback' as const };
      filedNames.push(named.name);

      // Does this supersede something already on file? An offer letter can be reissued
      // with different conditions, and staff must not keep working from the old one.
      const identical = existingDocs.find(
        (d) => d.originalName === att.filename && d.size === att.content.length,
      );
      const superseded = identical ? null : findSupersededDocument(existingDocs, named.name);

      if (identical) {
        versionNotes.push(
          `ℹ️ *${named.name}* is byte-identical to the copy already on file from ` +
            `${String(identical.uploadedAt).slice(0, 10)} — nothing new to review.`,
        );
      } else if (superseded) {
        const newText = await extractPdfText(att.content, att.contentType);
        const oldText = await fetchDocumentText(superseded);
        const comparison = await compareDocumentVersions({
          documentName: named.name,
          oldText,
          newText,
        });
        const when = String(superseded.uploadedAt).slice(0, 10);
        if (comparison.changed) {
          versionNotes.push(
            `⚠️ *${named.name}* is a NEW VERSION of the one on file from ${when}. What changed:\n${comparison.summary}`,
          );
        } else if (comparison.comparable) {
          versionNotes.push(
            `ℹ️ *${named.name}* matches the version already on file from ${when} — ${comparison.summary}`,
          );
        } else {
          versionNotes.push(
            `⚠️ *${named.name}* looks like another version of the one from ${when}, but ${comparison.summary}`,
          );
        }
      }

      const upload = await uploadStudentDocument({
        studentId: match.student.id,
        filename: att.filename,
        customName: named.name,
        content: att.content,
        contentType: att.contentType,
        note: `Received by email from ${message.from} — "${message.subject}"`,
        section: 'admin',
        uploaderId: EMAIL_INTAKE_USER_ID,
        // The same offer letter is often re-sent, or already saved by hand.
        skipIfDuplicate: true,
        notify: true,
      });
      if (!upload.success) {
        allOk = false;
        lastError = upload.error;
      } else if ('skipped' in upload) {
        // Already on the profile — say so in the chat note instead of silently dropping it.
        filedNames[filedNames.length - 1] = `${named.name} (already on file)`;
      }
    }

    if (allOk) {
      // Announce it in the student's internal chat so the employee, the admins and the
      // relevant department are all notified — this is how staff find out at all.
      const employeeCivilId = await getStudentEmployeeCivilId(match.student.id);
      const announcement = await announceEmailInChat({
        studentId: match.student.id,
        employeeCivilId,
        from: message.from,
        fromName: message.fromName,
        subject: message.subject,
        body: message.text,
        filedAttachments: filedNames,
        versionNotes,
      });

      await replyWithReceipt(message, {
        kind: 'filed',
        studentId: match.student.id,
        studentName: match.student.name,
        documents: filedNames,
        versionNotes,
        chatPosted: announcement.posted,
        chatRecipients: announcement.recipients ?? [],
      });

      await markMessageSeen(message.uid).catch(() => {});
      result.filed++;
      result.notified += announcement.posted ? 1 : 0;
      result.items.push({
        subject: message.subject,
        from: message.from,
        status: 'filed',
        studentId: match.student.id,
        studentName: match.student.name,
        // Show the names staff will actually see, with the original in brackets.
        attachments: filedNames.map((n, i) => `${n}  (was: ${attachmentNames[i]})`),
        chatPosted: announcement.posted,
        chatError: announcement.error,
      });
      await log({
        status: 'filed',
        studentId: match.student.id,
        studentName: match.student.name,
        from: message.from,
        subject: message.subject,
        attachments: attachmentNames,
        chatPosted: announcement.posted,
        chatRecipients: announcement.recipients ?? null,
        chatContent: announcement.content ?? null,
        chatError: announcement.error ?? null,
      });
    } else {
      // Upload failed: leave the message unread so the next run retries it.
      await replyWithReceipt(message, {
        kind: 'failed',
        reason: lastError ?? 'unknown error',
        studentName: match.student.name,
      });
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
      skipIfDuplicate: true,
      notify: true,
    });
    if (!upload.success) return { success: false, error: upload.error };
    if (!('skipped' in upload)) filed++;
  }

  // Same announcement as the automatic path, so a manually-filed document notifies the
  // employee and department too.
  const employeeCivilId = await getStudentEmployeeCivilId(studentId);
  const announcement = await announceEmailInChat({
    studentId,
    employeeCivilId,
    from: item.from ?? 'unknown',
    fromName: (item as { fromName?: string }).fromName,
    subject: item.subject ?? '',
    body: (item as { bodyPreview?: string }).bodyPreview ?? '',
    filedAttachments: attachments.map((a) => a.filename),
  });

  await ref.update({
    status: 'resolved',
    resolvedStudentId: studentId,
    resolvedBy: reviewerId,
    resolvedAt: new Date().toISOString(),
    chatPosted: announcement.posted,
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
