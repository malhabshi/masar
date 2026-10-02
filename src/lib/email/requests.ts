// Requests that arrive by email, and the replies they need.
//
// A university writes "please send the student's personal statement". The flow:
//   1. analyseEmail — the AI reads the email and lists what is being asked for.
//   2. recordEmailRequests — each ask becomes a Missing Item on the student, and the
//      email is remembered in `email_requests` (who to reply to, which thread).
//   3. fulfilEmailRequests — runs on a schedule. When the asked-for document appears on
//      the profile (or staff mark an information item received), a reply is written and
//      saved as a DRAFT in Gmail, in the same thread, with the documents attached.
//   4. A person opens Gmail and sends the drafts. Nothing here ever sends an email.
//
// Emails with nothing to answer — an offer issued, a CAS ready, a newsletter — create no
// request and no draft. Things to do elsewhere ("pay the deposit on the portal") become a
// Missing Item but never a draft: there is nothing to say back to the sender.

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, storage } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_DOC_MODEL, isAiConfigured } from '@/lib/ai/config';
import { CHAT_BOT_USER_ID, ensureChatBotUser } from '@/lib/ai/chat-bot';
import { DOC_TYPES, getDocumentReaderSettings, readDocument, type DocCard, type DocType } from '@/lib/ai/documents';
import { storagePathFromUrl } from '@/lib/mcp/document-tools';
import { sendChatMessage } from '@/lib/actions';
import { appendDraft, isInboxConfigured, type InboxMessage } from './inbox';

export const EMAIL_REQUESTS_COLLECTION = 'email_requests';
const BUCKET = 'studio-9484431255-91d96.firebasestorage.app';
/** Every reply draft is signed with this, below "Kind regards,". */
const DRAFT_SIGNATURE = 'MMohammed';
/** Gmail rejects messages over 25 MB; stay under it with room for encoding. */
const MAX_DRAFT_ATTACHMENT_BYTES = 17 * 1024 * 1024;

export type RequestKind = 'document' | 'information' | 'action';

export type RequestItem = {
  id: string;
  /** Short name of what is asked for, e.g. "Personal statement". */
  text: string;
  kind: RequestKind;
  /** For documents: the kind of file that satisfies it. */
  docType: DocType | null;
  /** The sender's wording, so the reply can answer it precisely. */
  detail: string;
  missingItemId: string;
  status: 'waiting' | 'ready' | 'drafted' | 'closed';
  fulfilledByDocId?: string | null;
  fulfilledAt?: string | null;
  draftedAt?: string | null;
};

export type EmailRequest = {
  id: string;
  studentId: string;
  studentName: string;
  sender: string;
  senderName: string | null;
  replyTo: string;
  subject: string;
  messageId: string | null;
  references: string[];
  receivedAt: string;
  /** Who the sender is, e.g. "INTO Newcastle". */
  organisation: string | null;
  items: RequestItem[];
  status: 'waiting' | 'drafted' | 'closed';
  drafts: Array<{ at: string; items: string[]; attachments: string[]; folder?: string }>;
  /** Uploads already compared against this request, so each file is judged only once. */
  seenDocIds?: string[];
  createdAt: string;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// --------------------------------------------------------------------------
// 1. Understanding the email
// --------------------------------------------------------------------------

const ANALYSE_SYSTEM = `You read emails sent to a Kuwaiti study-abroad agency about one of its students — usually from universities, pathway providers (INTO, Study Group, Kaplan, Navitas, OnCampus), the Kuwait Cultural Office or MOHE, sometimes from the student or a parent.

Call record_email exactly once.

List in requests ONLY what the sender asks the agency or the student to provide or do. Each request has a kind:
- "document": they want a file sent back to them (passport, transcript, certificate, IELTS result, personal statement, reference, bank statement, signed form…). Set docType to the kind of file.
- "information": they want an answer written back to them (confirm the start date, confirm whether the student accepts, give the student's address, answer a question).
- "action": something to be done elsewhere, not by replying (pay the deposit, accept on the portal, book a CAS interview, complete a form online).

Do NOT list:
- Information the sender is giving (an offer issued, a CAS ready, a visa decision, an interview date) — that is not a request.
- Marketing, newsletters, automated notifications with nothing asked.
- Conditions of an offer that the student will meet later (final exam results, the IELTS still to be taken) unless the email asks for them to be sent now.
- Anything already in the student's open missing items listed in the request.

One request per distinct thing. Keep text short, in English (e.g. "Personal statement", "Passport copy", "Confirm start date"). Put the sender's own wording in detail.
needsReply is true only if at least one request is "document" or "information".`;

const ANALYSE_TOOL: Anthropic.Tool = {
  name: 'record_email',
  description: 'Record what this email asks for.',
  input_schema: {
    type: 'object',
    properties: {
      organisation: { type: ['string', 'null'], description: 'Who sent it, short, e.g. "INTO Newcastle", "University of Leeds".' },
      needsReply: { type: 'boolean' },
      requests: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            kind: { type: 'string', enum: ['document', 'information', 'action'] },
            docType: { type: ['string', 'null'], enum: [...DOC_TYPES, null] },
            detail: { type: 'string' },
          },
          required: ['text', 'kind', 'detail'],
        },
      },
    },
    required: ['needsReply', 'requests'],
  },
};

export type EmailAnalysis = {
  organisation: string | null;
  needsReply: boolean;
  requests: Array<{ text: string; kind: RequestKind; docType: DocType | null; detail: string }>;
};

export async function analyseEmail(input: {
  subject: string;
  from: string;
  fromName?: string;
  body: string;
  attachmentNames: string[];
  studentName: string;
  openMissingItems: string[];
}): Promise<EmailAnalysis | null> {
  if (!isAiConfigured()) return null;
  try {
    const res = await getAnthropicClient().messages.create({
      model: AI_DOC_MODEL,
      max_tokens: 2000,
      system: [{ type: 'text', text: ANALYSE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [ANALYSE_TOOL],
      messages: [
        {
          role: 'user',
          content: [
            `Student: ${input.studentName}`,
            `Student's open missing items: ${input.openMissingItems.length ? input.openMissingItems.join('; ') : 'none'}`,
            `From: ${input.fromName ? `${input.fromName} <${input.from}>` : input.from}`,
            `Subject: ${input.subject}`,
            `Attachments: ${input.attachmentNames.join(', ') || 'none'}`,
            '',
            input.body.slice(0, 15_000),
          ].join('\n'),
        },
      ],
    });
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!use) return null;
    const i = use.input as Record<string, any>;
    const requests = (Array.isArray(i.requests) ? i.requests : [])
      .filter((r: any) => r && typeof r.text === 'string' && ['document', 'information', 'action'].includes(r.kind))
      .map((r: any) => ({
        text: String(r.text).trim().slice(0, 120),
        kind: r.kind as RequestKind,
        docType: (DOC_TYPES as readonly string[]).includes(r.docType) ? (r.docType as DocType) : null,
        detail: String(r.detail ?? '').trim().slice(0, 600),
      }));
    return {
      organisation: typeof i.organisation === 'string' ? i.organisation : null,
      needsReply: requests.some((r: { kind: RequestKind }) => r.kind !== 'action'),
      requests,
    };
  } catch (e) {
    console.error('[email-requests] analysis failed:', e);
    return null;
  }
}

// --------------------------------------------------------------------------
// 2. Recording the requests
// --------------------------------------------------------------------------

export async function getOpenMissingItemTexts(studentId: string): Promise<string[]> {
  const snap = await db().collection('students').doc(studentId).get();
  return ((snap.data()?.missingItems ?? []) as Array<string | { text?: string }>)
    .map((m) => (typeof m === 'string' ? m : m.text ?? ''))
    .filter(Boolean);
}

/**
 * Turn the analysed asks into Missing Items and remember the email so its reply can be
 * drafted later. Returns the lines for the chat note. Does nothing when nothing was asked.
 */
export async function recordEmailRequests(input: {
  message: InboxMessage;
  studentId: string;
  studentName: string;
  analysis: EmailAnalysis;
}): Promise<{ requestId: string | null; chatLines: string[] }> {
  const { message, studentId, studentName, analysis } = input;
  if (analysis.requests.length === 0) return { requestId: null, chatLines: [] };

  const now = new Date().toISOString();
  const from = analysis.organisation ?? message.fromName ?? message.from;
  const items: RequestItem[] = analysis.requests.map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text,
    kind: r.kind,
    docType: r.docType,
    detail: r.detail,
    missingItemId: `mi-email-${Date.now()}-${i}`,
    // An action has no reply; it is tracked only as a Missing Item.
    status: r.kind === 'action' ? 'closed' : 'waiting',
  }));

  // Missing Items, in the same shape the profile already shows.
  const missing = items.map((it) => ({
    id: it.missingItemId,
    text: `${it.text} — requested by ${from} by email (${now.slice(0, 10)})`,
    department: 'Email',
    addedBy: 'email-intake',
    createdAt: now,
  }));
  await db().collection('students').doc(studentId).update({
    missingItems: FieldValue.arrayUnion(...missing),
    newMissingItemsForEmployee: FieldValue.increment(missing.length),
    lastActivityAt: now,
  });

  let requestId: string | null = null;
  if (items.some((it) => it.status === 'waiting')) {
    const ref = db().collection(EMAIL_REQUESTS_COLLECTION).doc();
    const record: EmailRequest = {
      id: ref.id,
      studentId,
      studentName,
      sender: message.from,
      senderName: message.fromName || null,
      replyTo: message.replyTo || message.from,
      subject: message.subject,
      messageId: message.messageId,
      references: [...(message.references ?? []), ...(message.messageId ? [message.messageId] : [])],
      receivedAt: message.date,
      organisation: analysis.organisation,
      items,
      status: 'waiting',
      drafts: [],
      createdAt: now,
    };
    await ref.set(record);
    requestId = ref.id;
  }

  const chatLines = [
    '📋 Requested in this email (added to Missing Items):',
    ...items.map((it) => `• ${it.text}${it.kind === 'action' ? ' (to do, no reply needed)' : ''}`),
  ];
  if (requestId) {
    chatLines.push('Once these are uploaded to the profile, a reply with them is drafted in the agency Gmail for sending.');
  }
  return { requestId, chatLines };
}

// --------------------------------------------------------------------------
// 3. Noticing fulfilment and drafting the reply
// --------------------------------------------------------------------------

type StoredDoc = {
  id?: string;
  name?: string;
  originalName?: string;
  url?: string;
  size?: number;
  uploadedAt?: string;
  note?: string;
  ai?: DocCard;
};

/** The note the intake writes on files it saved from an email — see intake.ts. */
export function emailDocumentNote(from: string, subject: string): string {
  return `Received by email from ${from} — "${subject}"`;
}

const MATCH_SYSTEM = `You decide which newly uploaded documents satisfy what a university asked for by email. Call record_matches once. Match a document only when it is clearly the thing asked for (a passport for "Passport copy", an English certificate for "Secondary certificate in English"…). If unsure, do not match. One document can satisfy only one request.`;

const MATCH_TOOL: Anthropic.Tool = {
  name: 'record_matches',
  description: 'Record which document satisfies which request.',
  input_schema: {
    type: 'object',
    properties: {
      matches: {
        type: 'array',
        items: {
          type: 'object',
          properties: { requestId: { type: 'string' }, documentId: { type: 'string' } },
          required: ['requestId', 'documentId'],
        },
      },
    },
    required: ['matches'],
  },
};

async function matchDocuments(
  items: RequestItem[],
  docs: StoredDoc[],
): Promise<Array<{ requestId: string; documentId: string }>> {
  if (!items.length || !docs.length) return [];
  const res = await getAnthropicClient().messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 1000,
    system: MATCH_SYSTEM,
    tools: [MATCH_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          'Requests still waiting:',
          ...items.map((it) => `- ${it.id}: ${it.text}${it.docType ? ` [${it.docType}]` : ''} — "${it.detail}"`),
          '',
          'Documents uploaded since the email arrived:',
          ...docs.map(
            (d) =>
              `- ${d.id}: "${d.name ?? d.originalName}"` +
              (d.ai ? ` — read as ${d.ai.type}: ${d.ai.title}. ${d.ai.summary}` : ''),
          ),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const raw = ((use?.input as any)?.matches ?? []) as Array<{ requestId: string; documentId: string }>;
  const itemIds = new Set(items.map((i) => i.id));
  const docIds = new Set(docs.map((d) => d.id));
  const usedDocs = new Set<string>();
  return raw.filter((m) => {
    if (!itemIds.has(m.requestId) || !docIds.has(m.documentId) || usedDocs.has(m.documentId)) return false;
    usedDocs.add(m.documentId);
    return true;
  });
}

const DRAFT_SYSTEM = `You write email replies for a Kuwaiti study-abroad agency to universities and pathway providers. The reply is posted INSIDE the existing email thread, so the reader already has the student's name, the reference number, the course and their own request right above it.

Write only the body text. Plain text, no markdown. Be as short as possible:
- Greet with "Dear <organisation or Admissions> Team," (or the sender's name when it is a person).
- For documents: one line saying what is attached, by its short name, e.g. "Please find the signed offer acceptance form attached." or "Please find attached the FGL and the passport copy."
- For information: give the answer only, from the student record provided. If the record does not contain it, write "[ADD: <what is needed>]" in its place — never invent one.
- If the same email asked for other things that are still to come, add one line saying they will follow shortly, naming them, e.g. "The signed offer acceptance form and the underage consent form will follow shortly."
- Urgency: you are given today's date and the student's offers. Only if something makes this reply time-critical — most often, the course start date has already passed or is within two weeks and no CAS has been issued — add ONE short question that resolves it, e.g. "As the course started on 14 September, could you please confirm the latest arrival date?" If nothing is urgent, add nothing. Never add a question for its own sake.
- Do NOT repeat the student's name, reference numbers, course or anything else already in the thread. Do NOT explain what a document contains or why it is sent.
- No closing line, no sign-off, no name — the signature is added afterwards.`;

async function writeDraftBody(input: {
  request: EmailRequest;
  items: RequestItem[];
  /** Items from the same email that have not arrived yet — the reply says they will follow. */
  pendingItems: RequestItem[];
  attachmentNames: string[];
  studentRecord: string;
  /** What the student's offers and CAS say (from the document cards), for the urgency check. */
  offers: string[];
}): Promise<string> {
  const res = await getAnthropicClient().messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 800,
    system: DRAFT_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `Replying to: ${input.request.senderName ?? ''} <${input.request.replyTo}> (${input.request.organisation ?? 'unknown organisation'})`,
          `Original subject: ${input.request.subject}`,
          `Student: ${input.request.studentName}`,
          '',
          'Items this reply answers:',
          ...input.items.map((it) => `- [${it.kind}] ${it.text}: "${it.detail}"`),
          '',
          `Attached files: ${input.attachmentNames.join(', ') || 'none'}`,
          '',
          `Still to come from the same email: ${input.pendingItems.map((it) => it.text).join('; ') || 'nothing'}`,
          '',
          `Today: ${new Date().toISOString().slice(0, 10)}`,
          `Student's offers and CAS on file: ${input.offers.length ? '\n' + input.offers.join('\n') : 'none read yet'}`,
          '',
          'Student record (for information answers):',
          input.studentRecord,
        ].join('\n'),
      },
    ],
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new Error('The reply could not be written.');
  // The sign-off is added here, not by the model, so every draft ends the same way.
  const withoutSignOff = text.replace(/\n*(kind regards|best regards|regards|sincerely)[,.]?\s*$/i, '').trimEnd();
  return `${withoutSignOff}\n\nKind regards,\n${DRAFT_SIGNATURE}`;
}

function studentRecordForReply(s: Record<string, any>): string {
  const apps = (s.applications ?? [])
    .map((a: any) => `${a.university} — ${a.major} (${a.country}) — ${a.status}`)
    .join('; ');
  return [
    `Name: ${s.name}`,
    s.email ? `Email: ${s.email}` : null,
    s.phone ? `Phone: ${s.phone}` : null,
    s.jotformData?.dob ? `Date of birth: ${s.jotformData.dob}` : null,
    s.jotformData?.kuwaitAddress ? `Kuwait address: ${s.jotformData.kuwaitAddress}` : null,
    s.jotformData?.ukAddress ? `UK address: ${s.jotformData.ukAddress}` : null,
    s.jotformData?.ukPhone ? `UK phone: ${s.jotformData.ukPhone}` : null,
    s.jotformData?.guardianName ? `Guardian: ${s.jotformData.guardianName}` : null,
    s.jotformData?.guardianEmail ? `Guardian email: ${s.jotformData.guardianEmail}` : null,
    s.jotformData?.guardianPhone ? `Guardian phone: ${s.jotformData.guardianPhone}` : null,
    s.academicIntakeSemester ? `Intake: ${s.academicIntakeSemester} ${s.academicIntakeYear ?? ''}` : null,
    s.ieltsOverall ? `IELTS overall: ${s.ieltsOverall}` : null,
    apps ? `Applications: ${apps}` : null,
    s.finalChoiceUniversity ? `Final choice: ${s.finalChoiceUniversity}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** One line per offer / CAS the reader has already understood, for the urgency check. */
function offerLines(docs: StoredDoc[]): string[] {
  return docs
    .filter((d) => d.ai?.status === 'read' && ['offer', 'cas', 'i20'].includes(d.ai.type))
    .sort((a, b) => String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')))
    .slice(0, 6)
    .map((d) => {
      const f = d.ai!.facts;
      return `- ${d.ai!.title}: ${f.offerType ?? d.ai!.type}${f.course ? `, ${f.course}` : ''}${f.startDate ? `, starts ${f.startDate}` : ''} (uploaded ${String(d.uploadedAt ?? '').slice(0, 10)})`;
    });
}

async function downloadDoc(doc: StoredDoc): Promise<{ filename: string; content: Buffer } | null> {
  if (!storage) return null;
  const path = storagePathFromUrl(doc.url, BUCKET);
  if (!path) return null;
  const [bytes] = await storage.bucket(BUCKET).file(path).download();
  const original = doc.originalName || doc.name || 'document';
  const ext = original.match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? '';
  const base = (doc.name || original).replace(/\.[A-Za-z0-9]{1,5}$/, '');
  return { filename: `${base}${ext}`, content: bytes };
}

async function saveDraft(input: {
  request: EmailRequest;
  body: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}): Promise<{ ok: boolean; folder?: string; error?: string }> {
  const mailbox = process.env.SMTP_USER?.trim();
  if (!mailbox) return { ok: false, error: 'SMTP_USER is not set.' };
  const subject = /^re:/i.test(input.request.subject) ? input.request.subject : `Re: ${input.request.subject}`;
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true });
  const built = await builder.sendMail({
    from: mailbox,
    to: input.request.replyTo,
    subject,
    text: input.body,
    attachments: input.attachments.map((a) => ({ filename: a.filename, content: a.content })),
    ...(input.request.messageId
      ? { inReplyTo: input.request.messageId, references: input.request.references }
      : {}),
  });
  return appendDraft(built.message as Buffer);
}

/**
 * Check every waiting request: has what was asked for arrived? Draft the replies that
 * are ready. Safe to run often — a request with nothing new costs one Firestore read.
 */
export async function fulfilEmailRequests(opts: { limit?: number } = {}) {
  const result = { checked: 0, drafted: 0, itemsDrafted: 0, errors: [] as string[] };
  if (!isAiConfigured() || !isInboxConfigured()) return result;

  const snap = await db()
    .collection(EMAIL_REQUESTS_COLLECTION)
    .where('status', '==', 'waiting')
    .limit(opts.limit ?? 50)
    .get();

  const readerSettings = await getDocumentReaderSettings();

  for (const reqDoc of snap.docs) {
    const request = { ...(reqDoc.data() as EmailRequest), id: reqDoc.id };
    result.checked++;
    try {
      const studentSnap = await db().collection('students').doc(request.studentId).get();
      if (!studentSnap.exists) {
        await reqDoc.ref.update({ status: 'closed', closedReason: 'student no longer exists' });
        continue;
      }
      const s = studentSnap.data() ?? {};
      const docs: StoredDoc[] = s.documents ?? [];
      const openMissing = new Set(
        ((s.missingItems ?? []) as Array<string | { id?: string }>).map((m) => (typeof m === 'string' ? m : m.id ?? '')),
      );

      const items = request.items.map((it) => ({ ...it }));
      const waiting = items.filter((it) => it.status === 'waiting');
      const usedDocIds = new Set(items.map((it) => it.fulfilledByDocId).filter(Boolean) as string[]);

      // Documents: anything uploaded after the email arrived that is not already used.
      const waitingDocs = waiting.filter((it) => it.kind === 'document');
      if (waitingDocs.length) {
        // Files that came WITH the request are not the answer to it — a university that
        // attaches a form "to sign and return" must not have its own blank form sent back.
        const ownNote = emailDocumentNote(request.sender, request.subject);
        const seen = new Set(request.seenDocIds ?? []);
        const fresh = docs.filter(
          (d) =>
            d.id &&
            !usedDocIds.has(d.id) &&
            !seen.has(d.id) &&
            d.note !== ownNote &&
            String(d.uploadedAt ?? '') > request.receivedAt,
        );
        if (fresh.length) {
          request.seenDocIds = [...seen, ...fresh.map((d) => d.id!)];
          // Read any of them not yet read, so matching sees what they are, not just names.
          for (const d of fresh.filter((d) => !d.ai)) {
            d.ai = await readDocument(d, { name: s.name }, readerSettings);
          }
          const matches = await matchDocuments(waitingDocs, fresh);
          for (const m of matches) {
            const it = items.find((x) => x.id === m.requestId)!;
            it.status = 'ready';
            it.fulfilledByDocId = m.documentId;
            it.fulfilledAt = new Date().toISOString();
          }
        }
      }

      // Information items: ready when staff tick the Missing Item as received.
      for (const it of waiting.filter((x) => x.kind === 'information')) {
        if (!openMissing.has(it.missingItemId)) {
          it.status = 'ready';
          it.fulfilledAt = new Date().toISOString();
        }
      }

      // A document item ticked received with no file found is closed without a reply:
      // it was handled some other way, and a reply without the file would be wrong.
      for (const it of waiting.filter((x) => x.kind === 'document' && x.status === 'waiting')) {
        if (!openMissing.has(it.missingItemId)) it.status = 'closed';
      }

      const ready = items.filter((it) => it.status === 'ready');
      if (ready.length) {
        const attachments: Array<{ filename: string; content: Buffer }> = [];
        let total = 0;
        for (const it of ready.filter((x) => x.fulfilledByDocId)) {
          const d = docs.find((x) => x.id === it.fulfilledByDocId);
          const file = d ? await downloadDoc(d) : null;
          if (file && total + file.content.length <= MAX_DRAFT_ATTACHMENT_BYTES) {
            attachments.push(file);
            total += file.content.length;
          }
        }
        const body = await writeDraftBody({
          request,
          items: ready,
          attachmentNames: attachments.map((a) => a.filename),
          studentRecord: studentRecordForReply(s),
          pendingItems: items.filter((it) => it.status === 'waiting' && it.kind !== 'action'),
          offers: offerLines(docs),
        });
        const saved = await saveDraft({ request, body, attachments });
        if (!saved.ok) throw new Error(saved.error ?? 'Could not save the draft.');

        const now = new Date().toISOString();
        for (const it of ready) {
          it.status = 'drafted';
          it.draftedAt = now;
        }
        // The file is on its way: clear the Missing Item it answered.
        const answered = ((s.missingItems ?? []) as Array<any>).filter(
          (m) => typeof m !== 'string' && ready.some((it) => it.missingItemId === m.id),
        );
        if (answered.length) {
          await studentSnap.ref.update({ missingItems: FieldValue.arrayRemove(...answered) });
        }
        await reqDoc.ref.update({
          drafts: FieldValue.arrayUnion({
            at: now,
            items: ready.map((it) => it.text),
            attachments: attachments.map((a) => a.filename),
            folder: saved.folder ?? null,
          }),
        });
        result.drafted++;
        result.itemsDrafted += ready.length;

        await ensureChatBotUser();
        await sendChatMessage(
          request.studentId,
          CHAT_BOT_USER_ID,
          `✉️ Reply drafted in Gmail to ${request.organisation ?? request.replyTo}: ${ready.map((it) => it.text).join(' · ')}` +
            (attachments.length ? ` (${attachments.length} file${attachments.length > 1 ? 's' : ''} attached)` : '') +
            '. It is waiting in Drafts to be checked and sent.',
          ['admins'],
        ).catch(() => undefined);
      }

      const stillWaiting = items.some((it) => it.status === 'waiting');
      const status: EmailRequest['status'] = stillWaiting
        ? 'waiting'
        : items.some((it) => it.status === 'drafted')
          ? 'drafted'
          : 'closed';
      await reqDoc.ref.update({ items, status, seenDocIds: request.seenDocIds ?? [] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`${request.studentName}: ${msg}`);
      console.error('[email-requests] fulfil failed for', request.id, msg);
    }
  }
  return result;
}

/** The requests for the Email Documents page, newest first. */
export async function listEmailRequests(limit = 50) {
  const snap = await db()
    .collection(EMAIL_REQUESTS_COLLECTION)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map((d) => ({ ...(d.data() as EmailRequest), id: d.id }));
}
