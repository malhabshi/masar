// Email document intake.
//
// Pulls unread messages that carry attachments, works out which student each belongs to
// by full name, and either files the attachment onto that student's profile or parks it
// in a review queue for a human.
//
// The rule is deliberately strict: a document is filed automatically ONLY when exactly
// one student's complete registered name appears in the email. Nothing is ever guessed
// between two people — a passport on the wrong profile is a quiet, expensive error.

import { createHash } from 'crypto';
import { adminDb, storage } from '@/lib/firebase/admin';
import { findIdenticalDocument, uploadStudentDocument } from '@/lib/documents/upload';
import {
  applyLabel,
  fetchHeadersForUids,
  fetchMessageById,
  fetchMessageByUid,
  listUnhandledUids,
  INTAKE_LABELS,
  isInboxConfigured,
  markMessageSeen,
  type InboxAttachment,
  type InboxMessage,
} from './inbox';
import { loadStudentNames, matchStudentByName, nearMatchStudentByName, type MatchResult } from './matcher';
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
import { statusChangeLines, updateApplicationsFromEmail } from './application-status';
import { rememberEmail, syncSentMail } from './memory';
import { handleCompanyNotices } from './notices';
import { screenEmail } from './screen';
import { companyForAddress } from './companies';
import { logAiAction } from '@/lib/ai/action-log';
import {
  analyseEmail,
  emailDocumentNote,
  fulfilEmailRequests,
  getOpenMissingItemTexts,
  recordEmailRequests,
} from './requests';

export const INTAKE_QUEUE_COLLECTION = 'email_intake_queue';
export const INTAKE_LOG_COLLECTION = 'email_intake_log';

/** Uploader id recorded against documents filed from email. */
export const EMAIL_INTAKE_USER_ID = 'email-intake';

export type IntakeItemStatus = 'filed' | 'pending_review' | 'failed';

export type IntakeResult = {
  /** Gmail drafts created this run for requests that are now fulfilled. */
  draftsCreated?: number;
  draftErrors?: string[];
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
 * This is the ONLY thing preventing duplicates now — read/unread is deliberately left
 * alone for staff to use, so the mailbox itself no longer records what has been handled.
 * Keyed on the RFC822 Message-ID, which is stable and unique per email.
 */
function claimKey(messageId: string | null, uid: number): string {
  return (messageId ?? `uid-${uid}`).replace(/[^\w.@-]/g, '_').slice(0, 400);
}

/**
 * A claim is a lease while the message is being processed and a permanent record once it
 * is done. If a run dies after claiming (time limit, crash) the catch-based release never
 * runs; a 'processing' claim older than this is taken to be abandoned and the email is
 * picked up again instead of being skipped forever. Claims written before this field
 * existed have no state and count as done.
 */
const CLAIM_LEASE_MS = 30 * 60_000;

/**
 * Test mode leaves other students' mail for later. Each such email is still remembered (so
 * the email memory stays current) and noted here, so later runs do not download it again.
 * The note names the test student: when test mode changes or ends, the mail is processed
 * in full as normal.
 */
const TEST_SKIPS = 'email_intake_test_skips';
/** Keyed on the test student and their current name: renaming them reconsiders every email. */
const testSkipKey = (messageId: string | null, uid: number, testStudentId: string, testStudentName: string) =>
  `${claimKey(messageId, uid)}__${testStudentId}__${createHash('sha1').update(testStudentName).digest('hex').slice(0, 10)}`;

/**
 * Mail received before this moment is never processed. It is set on the first run, so
 * going live works on the mail that arrives from then on instead of the whole old inbox
 * (whose history the email memory already holds).
 */
async function processFrom(): Promise<Date> {
  if (!adminDb) return new Date();
  const ref = adminDb.collection('app_settings').doc('email_intake_state');
  const at = (await ref.get()).data()?.processFrom;
  if (typeof at === 'string' && !Number.isNaN(Date.parse(at))) return new Date(at);
  const now = new Date().toISOString();
  await ref.set({ processFrom: now }, { merge: true });
  return new Date(now);
}

function claimIsLive(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return false;
  if (data.state !== 'processing') return true;
  return Date.now() - new Date(data.claimedAt ?? 0).getTime() < CLAIM_LEASE_MS;
}

async function claimMessage(messageId: string | null, uid: number): Promise<boolean> {
  if (!adminDb) return true; // No DB means no dedupe; better to process than to stall.
  const ref = adminDb.collection('email_intake_seen').doc(claimKey(messageId, uid));
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && claimIsLive(snap.data())) return false;
      tx.set(ref, { messageId, uid, state: 'processing', claimedAt: new Date().toISOString() });
      return true;
    });
  } catch (e) {
    console.error('[email-intake] Claim failed:', e);
    return false;
  }
}

/** Cheap pre-check used before downloading a message in full. */
async function isAlreadyHandled(messageId: string | null, uid: number): Promise<boolean> {
  if (!adminDb) return false;
  try {
    const snap = await adminDb.collection('email_intake_seen').doc(claimKey(messageId, uid)).get();
    return snap.exists && claimIsLive(snap.data());
  } catch {
    return false;
  }
}

/** The message is fully handled: the claim becomes a permanent record. */
async function completeClaim(messageId: string | null, uid: number): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb
      .collection('email_intake_seen')
      .doc(claimKey(messageId, uid))
      .set({ state: 'done', doneAt: new Date().toISOString() }, { merge: true });
  } catch (e) {
    console.error('[email-intake] Could not complete claim:', e);
  }
}

/**
 * Give up a claim so the message is retried next run.
 *
 * Without this a transient failure (Storage hiccup, network blip) would claim the
 * message, fail to file it, and then be skipped forever as "already handled".
 */
async function releaseClaim(messageId: string | null, uid: number): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection('email_intake_seen').doc(claimKey(messageId, uid)).delete();
  } catch (e) {
    console.error('[email-intake] Could not release claim:', e);
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

/**
 * Tell the owner on the site, not only in the email's Gmail thread, that an email is
 * waiting for someone to choose its student.
 */
async function notifyUnmatched(message: InboxMessage, reason: string): Promise<void> {
  if (!adminDb) return;
  const owner = process.env.MCP_OWNER_USER_ID?.trim();
  const recipients = owner
    ? [owner]
    : (await adminDb.collection('users').where('role', '==', 'admin').get()).docs.map((d) => d.id);
  if (!recipients.length) return;
  await adminDb.collection('tasks').add({
    authorId: 'system',
    createdBy: 'system',
    recipientId: recipients[0],
    recipientIds: recipients,
    content: `📥 An email could not be matched to a student: "${message.subject}" from ${message.fromName || message.from}. ${reason} Choose the student on the Email Documents page.`,
    createdAt: new Date().toISOString(),
    status: 'new',
    category: 'system',
    replies: [],
  });
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
  // A queue item without its file would later be "resolved" with nothing to file. Fail
  // instead: the caller releases the claim and the email is retried on the next run.
  const missing = stashed.filter((a) => !a.url).map((a) => a.filename);
  if (missing.length) throw new Error(`Could not store ${missing.join(', ')} for review.`);

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
/** Draft any replies whose requested documents have now arrived. Never throws. */
async function runFulfilment(result: IntakeResult): Promise<void> {
  // The agency's own replies go into the memory too.
  await syncSentMail().catch((e) => console.error('[email-intake] sent-mail sync failed:', e));
  try {
    if (!(await getIntakeSettings()).draftReplies) return;
    const r = await fulfilEmailRequests();
    result.draftsCreated = r.drafted;
    if (r.errors.length) result.draftErrors = r.errors;
  } catch (e) {
    console.error('[email-intake] fulfilment failed:', e);
  }
}

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

  // Phase 1 — which messages to look at: mail the system has not labelled yet, read or
  // unread, oldest first. The label search leaves handled mail out, and the claims below
  // catch anything whose label failed to apply.
  let uids: number[];
  let since: Date;
  try {
    since = await processFrom();
    uids = await listUnhandledUids(since);
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await log({ status: 'error', reason });
    result.failed++;
    result.items.push({ subject: '(inbox)', from: '', status: 'failed', reason, attachments: [] });
    return result;
  }

  if (uids.length === 0) {
    await runFulfilment(result);
    return result;
  }

  const mailbox = (process.env.SMTP_USER ?? '').toLowerCase();
  const limit = options.limit ?? 20;

  const settings = await getIntakeSettings();
  const students = await loadStudentNames();
  // Staff addresses: an email from one that names no student was sent on purpose.
  const staffAddresses = new Set(
    ((await adminDb?.collection('users').select('email').get())?.docs ?? [])
      .map((d) => String(d.data().email ?? '').trim().toLowerCase())
      .filter(Boolean),
  );

  // Phase 2 — walk the list a page of envelopes at a time until `limit` unhandled
  // messages are found or the list ends; download in full only those. In test mode only
  // the chosen student's mail counts toward the limit — otherwise other students' mail
  // fills every batch and that student's email is never reached.
  const messages: InboxMessage[] = [];
  for (let i = 0; i < uids.length && messages.length < limit; i += 50) {
    const page = await fetchHeadersForUids(uids.slice(i, i + 50));
    for (const head of page) {
      // Our own receipts must never sit in the unread count staff rely on.
      if (mailbox && head.from.toLowerCase() === mailbox) {
        await markMessageSeen(head.uid);
        continue;
      }
      if (messages.length >= limit) break;
      // Gmail's search works by whole days; this is the exact cut.
      if (new Date(head.date) < since) continue;

      // Already dealt with in an earlier run — skip without downloading attachments.
      if (await isAlreadyHandled(head.messageId, head.uid)) continue;
      const testSkip =
        settings.restrictToStudentId && adminDb
          ? adminDb
              .collection(TEST_SKIPS)
              .doc(
                testSkipKey(
                  head.messageId,
                  head.uid,
                  settings.restrictToStudentId,
                  students.find((s) => s.id === settings.restrictToStudentId)?.normalized ?? '',
                ),
              )
          : null;
      if (testSkip && (await testSkip.get()).exists) {
        result.skipped++;
        continue;
      }

      try {
        const full = await fetchMessageByUid(head.uid);
        if (full && testSkip) {
          const m = matchStudentByName([full.fromName, full.subject, full.text].filter(Boolean).join(' \n '), students);
          if (m.kind !== 'matched' || m.student.id !== settings.restrictToStudentId) {
            if (m.kind === 'matched') {
              await rememberEmail({
                studentId: m.student.id,
                studentName: m.student.name,
                direction: 'in',
                date: full.date,
                from: full.fromName ? `${full.fromName} <${full.from}>` : full.from,
                to: process.env.SMTP_USER ?? '',
                subject: full.subject,
                messageId: full.messageId,
                body: full.text,
                attachments: full.attachments.map((a) => a.filename),
              }).catch(() => undefined);
            }
            // An email naming two students is not noted: who it belongs to may still be settled.
            if (m.kind !== 'ambiguous') {
              await testSkip.set({ at: new Date().toISOString(), studentId: m.kind === 'matched' ? m.student.id : null }).catch(() => undefined);
            }
            result.skipped++;
            continue;
          }
        }
        if (full) messages.push(full);
      } catch (e) {
        console.error('[email-intake] Could not download message', head.uid, e);
      }
    }
  }

  if (messages.length === 0) {
    await runFulfilment(result);
    return result;
  }

  for (const message of messages) {
    // Once a message is claimed it counts as handled forever, so anything that fails
    // after the claim must give it back — otherwise it is never retried.
    let claimed = false;
    let released = false;
    let failed = false;
    const release = async () => {
      released = true;
      await releaseClaim(message.messageId, message.uid);
    };
    try {
      result.processed++;
      const attachmentNames = message.attachments.map((a) => a.filename);

      // Search the sender's display name, the subject and the body together.
      const searchText = [message.fromName, message.subject, message.text].filter(Boolean).join(' \n ');
      let match: MatchResult = matchStudentByName(searchText, students);
      // No exact name: the same name spelt a letter differently still finds the student,
      // and the chat note says so, so the profile name can be corrected.
      let nameLines: string[] = [];
      if (match.kind === 'no_match') {
        const near = nearMatchStudentByName(searchText, students);
        if (near) {
          match = { kind: 'matched', student: near.student };
          nameLines = [
            `⚠️ Matched by a close spelling: the email says "${near.found}", the profile says "${near.student.name}". If the profile name is misspelt, correct it (Masar AI can, if you ask).`,
          ];
        }
      }

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
        continue;
      }
      claimed = true;

      // One cheap look decides which of the costly steps below this email needs at all.
      // Run lazily, once, and only if one of those steps is switched on.
      // JotForm's own confirmation copies are already handled by the JotForm page: no AI.
      const isFormCopy = /(^|\.)jotform\.com$/i.test(message.from.split('@')[1] ?? '');
      let screened: Awaited<ReturnType<typeof screenEmail>> | null = null;
      const screen = async () =>
        (screened ??= isFormCopy ? { applicationNews: false, generalNotice: false, asksForSomething: false } : await screenEmail(message));

      // News for everyone ("applications for this course are closed") — read from every
      // company email, identified or not, since a general notice often names no student.
      // Skipped in test mode: it would act on students outside the test.
      const noticeLines =
        settings.reactToNotices &&
        !settings.restrictToStudentId &&
        (await companyForAddress(message.from)) &&
        (await screen()).generalNotice
          ? await handleCompanyNotices(message)
          : [];

      if (match.kind !== 'matched') {
        const reason =
          match.kind === 'ambiguous'
            ? `Name matched ${match.candidates.length} students — needs a human to choose.`
            : 'No student name found in the email.';

        // An unidentified email carrying a document must never be dropped. An unidentified
        // email with no attachment is usually a newsletter or spam, so it is logged and
        // marked read rather than filling the review queue — unless a member of staff sent
        // or forwarded it (someone asking for it to be dealt with), or a company wrote about
        // an application (a name spelt differently from the profile must reach a person,
        // not vanish under the masar/filed label).
        const aboutAnApplication =
          !!(await companyForAddress(message.from)) && ((await screen()).applicationNews || (await screen()).asksForSomething);
        if (message.attachments.length === 0 && !staffAddresses.has(message.from.toLowerCase()) && !aboutAnApplication) {
          await replyWithReceipt(message, { kind: 'skipped', reason, notices: noticeLines });
          await applyLabel(message.uid, INTAKE_LABELS.noAction);
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
        await notifyUnmatched(message, reason).catch((e) => console.error('[email-intake] could not notify:', e));
        await replyWithReceipt(message, { kind: 'queued', reason, attachments: attachmentNames, notices: noticeLines });
        await applyLabel(message.uid, INTAKE_LABELS.review);
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
        const identical = await findIdenticalDocument(existingDocs, att.content, att.filename);
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
          note: emailDocumentNote(message.from, message.subject),
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
        // What does the email ask for? Each ask becomes a Missing Item; asks that need an
        // answer are remembered so a reply can be drafted once they are on the profile.
        let requestLines: string[] = [];
        if (settings.draftReplies && (await screen()).asksForSomething) {
          const analysis = await analyseEmail({
            subject: message.subject,
            from: message.from,
            fromName: message.fromName,
            body: message.text,
            attachmentNames,
            studentName: match.student.name,
            openMissingItems: await getOpenMissingItemTexts(match.student.id),
          });
          if (analysis) {
            const recorded = await recordEmailRequests({
              message,
              studentId: match.student.id,
              studentName: match.student.name,
              analysis,
            }).catch((e) => {
              console.error('[email-intake] could not record requests:', e);
              return { requestId: null, chatLines: [] as string[] };
            });
            requestLines = recorded.chatLines;
          }
        }

        // What does the email mean for the student's applications? An offer → Accepted,
        // "application received" → Submitted, and so on, under the agency's rules.
        let statusLines: string[] = [];
        if (settings.autoApplicationStatus && (await screen()).applicationNews) {
          statusLines = statusChangeLines(
            await updateApplicationsFromEmail({ message, studentId: match.student.id }),
          );
        }

        // Keep it in the student's email memory, so the AI knows the whole story later.
        await rememberEmail({
          studentId: match.student.id,
          studentName: match.student.name,
          direction: 'in',
          date: message.date,
          from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
          to: process.env.SMTP_USER ?? '',
          subject: message.subject,
          messageId: message.messageId,
          body: message.text,
          attachments: attachmentNames,
        });

        // Announce it in the student's internal chat only when it needs someone: something
        // the email asks for, a changed version of a document, a status the AI would not set
        // by itself, a change of agent, or a company notice. Routine news ("application
        // received", an offer filed and its status set) stays out of the chat — the document
        // is on the profile, and a status change already notifies the employee. JotForm
        // copies are our own submissions, so they never need a note.
        const needsSomeone =
          !isFormCopy &&
          (nameLines.length > 0 ||
            noticeLines.length > 0 ||
            requestLines.length > 0 ||
            statusLines.some((l) => !l.startsWith('🎓')) ||
            versionNotes.some((l) => l.startsWith('⚠️')));
        const employeeCivilId = needsSomeone ? await getStudentEmployeeCivilId(match.student.id) : null;
        const announcement: Awaited<ReturnType<typeof announceEmailInChat>> & { skipped?: boolean } = needsSomeone
          ? await announceEmailInChat({
              studentId: match.student.id,
              employeeCivilId,
              from: message.from,
              fromName: message.fromName,
              subject: message.subject,
              body: message.text,
              filedAttachments: filedNames,
              versionNotes,
              requestNotes: [...nameLines, ...noticeLines, ...statusLines, ...requestLines],
            })
          : { posted: false, skipped: true };

        await replyWithReceipt(message, {
          kind: 'filed',
          studentId: match.student.id,
          studentName: match.student.name,
          documents: filedNames,
          versionNotes,
          requestNotes: [...nameLines, ...requestLines],
          statusNotes: statusLines,
          notices: noticeLines,
          chatPosted: announcement.posted,
          chatSkipped: announcement.skipped,
          chatRecipients: announcement.recipients ?? [],
        });

        if (filedNames.length) {
          await logAiAction({
            source: 'email',
            summary: `Filed from email: ${filedNames.join(' · ')}`,
            reason: `Email from ${message.fromName || message.from}, "${message.subject}"`,
            studentId: match.student.id,
            studentName: match.student.name,
            undo: { type: 'none' },
          });
        }
        await applyLabel(message.uid, INTAKE_LABELS.filed);
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
          chatSkipped: announcement.skipped ?? false,
          chatRecipients: announcement.recipients ?? null,
          chatContent: announcement.content ?? null,
          chatError: announcement.error ?? null,
        });
      } else {
        // Upload failed: release the claim and apply no label, so the next run retries it.
        await release();
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
    } catch (e) {
      failed = true;
      const reason = e instanceof Error ? e.message : String(e);
      if (claimed && !released) await release().catch(() => undefined);
      result.failed++;
      result.items.push({ subject: message.subject, from: message.from, status: 'failed', reason, attachments: message.attachments.map((a) => a.filename) });
      await log({ status: 'failed', from: message.from, subject: message.subject, reason: `${reason} — will retry` });
    } finally {
      // Every path that kept its claim (filed, queued, skipped as no-action) is now done.
      if (claimed && !released && !failed) await completeClaim(message.messageId, message.uid);
    }
  }

  await runFulfilment(result);
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
    messageId?: string | null;
    attachments?: Array<{ filename: string; contentType: string; url: string | null }>;
  };
  if (item.status === 'resolved') return { success: false, error: 'Already resolved.' };

  const attachments = item.attachments ?? [];
  let filed = 0;

  const missing = attachments.filter((a) => !a.url).map((a) => a.filename);
  if (missing.length) {
    return {
      success: false,
      error: `${missing.join(', ')} was not stored when the email arrived — file it from the original email in Gmail.`,
    };
  }

  const filedNames: string[] = [];
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
    filedNames.push('skipped' in upload ? `${att.filename} (already on file)` : att.filename);
  }

  // What the email says about the applications ("application received", an offer), as
  // for an email matched automatically — read again in full from Gmail — and into the
  // student's email memory.
  let statusLines: string[] = [];
  const full = item.messageId ? await fetchMessageById(item.messageId).catch(() => null) : null;
  if (full) {
    const settings = await getIntakeSettings();
    if (settings.autoApplicationStatus) {
      statusLines = statusChangeLines(await updateApplicationsFromEmail({ message: full, studentId }));
    }
    const student = (await adminDb.collection('students').doc(studentId).get()).data();
    await rememberEmail({
      studentId,
      studentName: String(student?.name ?? ''),
      direction: 'in',
      date: full.date,
      from: full.fromName ? `${full.fromName} <${full.from}>` : full.from,
      to: process.env.SMTP_USER ?? '',
      subject: full.subject,
      messageId: full.messageId,
      body: full.text,
      attachments: full.attachments.map((a) => a.filename),
    }).catch(() => undefined);
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
    filedAttachments: filedNames,
    requestNotes: statusLines,
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
