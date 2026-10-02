// Reading the documents on a student's profile.
//
// Nearly every student carries the same handful of documents — passport, school
// certificate, transcript, IELTS result, offer letters, CAS or I-20 — so each one is read
// once, its key facts are pulled out, and the result is stored on the document itself as
// `ai` (a "card"). After that the assistant, the chat responder and the routines answer
// from the card instead of opening the file again.
//
// How a file reaches the model:
//   - PDFs with a text layer (most offer letters) are sent as text, which is cheap.
//   - Scanned PDFs and photos are sent as the file itself, so the model reads the page.
//   - Word files and anything oversized are recorded as unreadable, with the reason.
//
// Passports are read only while app_settings/ai_documents.readPassports is on. With it
// off, a passport is identified by name and left unread — its image never leaves storage.

import Anthropic from '@anthropic-ai/sdk';
import { adminDb, storage } from '@/lib/firebase/admin';
import { getAnthropicClient } from './client';
import { AI_DOC_MODEL, isAiConfigured } from './config';
import { extractPdfText } from '@/lib/email/document-compare';
import { mimeFromName, storagePathFromUrl } from '@/lib/mcp/document-tools';

const BUCKET = 'studio-9484431255-91d96.firebasestorage.app';

/** Bump when the card's shape or the instructions change enough to warrant a re-read. */
export const CARD_VERSION = 1;

/** The API's per-image limit is 5 MB of base64; leave room for the encoding overhead. */
const MAX_IMAGE_BYTES = 3_700_000;
const MAX_PDF_BYTES = 20_000_000;
/** Below this much extracted text a PDF is a scan, and the page itself is sent instead. */
const MIN_TEXT_CHARS = 200;
/** Offer letters can run long; the facts are on the first pages. */
const MAX_TEXT_CHARS = 40_000;

export const DOC_TYPES = [
  'offer', 'cas', 'i20', 'ielts', 'toefl', 'passport', 'civil_id', 'transcript',
  'school_certificate', 'personal_statement', 'recommendation', 'visa', 'mohe',
  'financial', 'medical', 'receipt', 'jotform_summary', 'photo', 'cv', 'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export type DocFacts = {
  university?: string | null;
  course?: string | null;
  level?: string | null;
  offerType?: 'conditional' | 'unconditional' | null;
  conditions?: string[] | null;
  startDate?: string | null;
  deposit?: string | null;
  deadline?: string | null;
  referenceNumber?: string | null;
  ieltsOverall?: number | null;
  listening?: number | null;
  reading?: number | null;
  writing?: number | null;
  speaking?: number | null;
  testDate?: string | null;
  grade?: string | null;
  fullName?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  documentNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  amount?: string | null;
};

export type DocCard = {
  version: number;
  status: 'read' | 'named_only' | 'unreadable' | 'error';
  type: DocType;
  title: string;
  summary: string;
  facts: DocFacts;
  /** The name printed on the document, and whether it is this student. */
  nameOnDocument?: string | null;
  matchesStudent?: boolean | null;
  readAt: string;
  model?: string;
  via?: 'text' | 'pdf' | 'image' | 'name';
  reason?: string;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
};

type StoredDoc = {
  id?: string;
  name?: string;
  originalName?: string;
  url?: string;
  size?: number;
  uploadedAt?: string;
  ai?: DocCard;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// --------------------------------------------------------------------------
// Settings
// --------------------------------------------------------------------------

export type DocumentReaderSettings = {
  /** Read new uploads automatically on the scheduled sweep. */
  autoRead: boolean;
  /** Send passport images to the model. Off means passports are identified by name only. */
  readPassports: boolean;
};

const SETTINGS_REF = () => db().collection('app_settings').doc('ai_documents');

export async function getDocumentReaderSettings(): Promise<DocumentReaderSettings> {
  try {
    const d = (await SETTINGS_REF().get()).data() ?? {};
    return { autoRead: d.autoRead === true, readPassports: d.readPassports === true };
  } catch {
    return { autoRead: false, readPassports: false };
  }
}

export async function saveDocumentReaderSettings(patch: Partial<DocumentReaderSettings>) {
  const cur = await getDocumentReaderSettings();
  const next: DocumentReaderSettings = {
    autoRead: typeof patch.autoRead === 'boolean' ? patch.autoRead : cur.autoRead,
    readPassports: typeof patch.readPassports === 'boolean' ? patch.readPassports : cur.readPassports,
  };
  await SETTINGS_REF().set({ ...next, updatedAt: new Date().toISOString() }, { merge: true });
  return next;
}

// --------------------------------------------------------------------------
// Naming — what a document probably is, from its name alone
// --------------------------------------------------------------------------

const NAME_RULES: Array<[DocType, RegExp]> = [
  ['passport', /passport|جواز|paspor/i],
  ['civil_id', /civil|مدني|البطاق/i],
  ['cas', /\bcas\b/i],
  ['i20', /i-?20\b/i],
  ['toefl', /toefl|توفل/i],
  ['ielts', /ielts|ايلتس|آيلتس|\btrf\b/i],
  ['transcript', /transcript|كشف درجات|grades|marks/i],
  ['school_certificate', /certif|شهاد|diploma|secondary|high ?school|ثانوي/i],
  ['personal_statement', /personal statement|\bsop\b|statement/i],
  ['recommendation', /recommend|reference letter|توصي/i],
  ['visa', /visa|تأشير|فيزا/i],
  ['mohe', /mohe|بعث|scholar|وزار|ministry|cultural|ملحق/i],
  ['financial', /bank|financ|sponsor|كفال/i],
  ['medical', /medical|طبي|fitness|health/i],
  ['receipt', /invoice|receipt|فاتور|ايصال|payment/i],
  ['jotform_summary', /summary|jotform/i],
  ['cv', /\bcv\b|resume/i],
  ['offer', /offer|acceptance|قبول|uncondition|condition/i],
];

export function guessTypeFromName(name: string): DocType | null {
  for (const [type, rx] of NAME_RULES) if (rx.test(name)) return type;
  return null;
}

// --------------------------------------------------------------------------
// Reading one document
// --------------------------------------------------------------------------

const SYSTEM = `You read documents from a Kuwaiti study-abroad agency's student files and record what each one is and the facts that matter.

The documents are the usual set for students applying to universities in the UK, USA, Australia, New Zealand and Ireland: passports, Kuwaiti civil IDs, school certificates and transcripts (often in Arabic), IELTS/TOEFL results, offer letters (conditional or unconditional, often from pathway providers such as INTO, Study Group, Kaplan, Navitas, OnCampus), CAS letters, I-20s, visas, MOHE scholarship letters, bank statements, receipts, personal statements.

Call record_document exactly once.
- type: what the document IS. An offer letter from a pathway provider is still "offer".
- title: a short name in the agency's style, e.g. "University of Leeds - Offer Letter", "IELTS Result", "Passport", "Final Transcript", "CAS Letter".
- summary: one plain sentence staff can act on, e.g. "Conditional offer for Foundation in Engineering starting Sep 2026; needs IELTS 5.5 and a £3,000 deposit by 15 Jul."
- The fact fields: fill only what the document actually states. Dates as YYYY-MM-DD where the day is known. Never guess a value; leave it null.
- For offers, list every condition separately in conditions (English score, grades, documents, deposit…).
- nameOnDocument: the person's name as printed. matchesStudent: true if it is clearly the student named in the request, false if clearly someone else, null if you cannot tell.
- If the file is blank, unreadable or not a document, use type "other" and say so in summary.`;

/** Fact fields, kept flat on the tool input: nested objects came back garbled on long offers. */
const FACT_FIELDS: Record<keyof DocFacts, Record<string, unknown>> = {
  university: { type: ['string', 'null'] },
  course: { type: ['string', 'null'] },
  level: { type: ['string', 'null'], description: 'Foundation, First Year, Bachelor, Master…' },
  offerType: { type: ['string', 'null'], enum: ['conditional', 'unconditional', null] },
  conditions: { type: ['array', 'null'], items: { type: 'string' }, description: 'Offers: one entry per condition.' },
  startDate: { type: ['string', 'null'] },
  deposit: { type: ['string', 'null'], description: 'Amount with currency.' },
  deadline: { type: ['string', 'null'], description: 'The deadline to accept or pay, if any.' },
  referenceNumber: { type: ['string', 'null'], description: 'Student/application ID, CAS number, SEVIS ID, TRF number.' },
  ieltsOverall: { type: ['number', 'null'] },
  listening: { type: ['number', 'null'] },
  reading: { type: ['number', 'null'] },
  writing: { type: ['number', 'null'] },
  speaking: { type: ['number', 'null'] },
  testDate: { type: ['string', 'null'] },
  grade: { type: ['string', 'null'], description: 'Overall percentage or GPA.' },
  fullName: { type: ['string', 'null'] },
  dateOfBirth: { type: ['string', 'null'] },
  nationality: { type: ['string', 'null'] },
  documentNumber: { type: ['string', 'null'], description: 'Passport / civil ID / visa number.' },
  issueDate: { type: ['string', 'null'] },
  expiryDate: { type: ['string', 'null'] },
  amount: { type: ['string', 'null'], description: 'For receipts and financial documents.' },
};

const RECORD_TOOL: Anthropic.Tool = {
  name: 'record_document',
  description: 'Record what this document is and its key facts. Leave any fact the document does not state as null.',
  input_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: [...DOC_TYPES] },
      title: { type: 'string' },
      summary: { type: 'string' },
      nameOnDocument: { type: ['string', 'null'] },
      matchesStudent: { type: ['boolean', 'null'] },
      ...FACT_FIELDS,
    },
    required: ['type', 'title', 'summary'],
  },
};

function cleanFacts(input: Record<string, unknown>): DocFacts {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(FACT_FIELDS)) {
    const v = input[k];
    if (v === null || v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as DocFacts;
}

function quickCard(type: DocType, title: string, status: DocCard['status'], reason: string): DocCard {
  return { version: CARD_VERSION, status, type, title, summary: reason, facts: {}, readAt: new Date().toISOString(), via: 'name', reason };
}

/** Read one stored document and return its card. Never throws. */
export async function readDocument(
  doc: StoredDoc,
  student: { name?: string | null },
  settings: DocumentReaderSettings,
): Promise<DocCard> {
  const name = doc.name || doc.originalName || 'Untitled';
  const nameType = guessTypeFromName(`${doc.name ?? ''} ${doc.originalName ?? ''}`) ?? 'other';

  try {
    if (!isAiConfigured()) return quickCard(nameType, name, 'named_only', 'The AI is not configured.');
    if (nameType === 'passport' && !settings.readPassports) {
      return quickCard('passport', 'Passport', 'named_only', 'Passport reading is switched off; identified by name only.');
    }
    if (!storage) throw new Error('Storage is not available.');
    const path = storagePathFromUrl(doc.url, BUCKET);
    if (!path) return quickCard(nameType, name, 'unreadable', 'No readable storage link on file.');

    const file = storage.bucket(BUCKET).file(path);
    const [exists] = await file.exists();
    if (!exists) return quickCard(nameType, name, 'unreadable', 'The file is missing from storage.');
    const [meta] = await file.getMetadata();
    const size = Number(meta.size) || doc.size || 0;
    const mime =
      meta.contentType && meta.contentType !== 'application/octet-stream'
        ? meta.contentType
        : mimeFromName(doc.originalName || doc.name || '');

    let content: Anthropic.ContentBlockParam;
    let via: DocCard['via'];
    if (mime.startsWith('image/')) {
      if (size > MAX_IMAGE_BYTES) return quickCard(nameType, name, 'unreadable', `Image is ${(size / 1e6).toFixed(1)} MB, too large to send.`);
      const [bytes] = await file.download();
      const media = (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime) ? mime : 'image/jpeg') as
        'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
      content = { type: 'image', source: { type: 'base64', media_type: media, data: bytes.toString('base64') } };
      via = 'image';
    } else if (mime === 'application/pdf') {
      if (size > MAX_PDF_BYTES) return quickCard(nameType, name, 'unreadable', `PDF is ${(size / 1e6).toFixed(1)} MB, too large to send.`);
      const [bytes] = await file.download();
      const text = await extractPdfText(bytes, 'application/pdf');
      if (text && text.length >= MIN_TEXT_CHARS) {
        content = { type: 'text', text: `Document text:\n\n${text.slice(0, MAX_TEXT_CHARS)}` };
        via = 'text';
      } else {
        content = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } };
        via = 'pdf';
      }
    } else {
      return quickCard(nameType, name, 'unreadable', `${mime} files are not read; identified by name only.`);
    }

    const client = getAnthropicClient('documents');
    const res = await client.messages.create({
      model: AI_DOC_MODEL,
      max_tokens: 4000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      // Forcing the tool (tool_choice) is not accepted by this model; the system prompt
      // tells it to call record_document, and a reply without the call is an error below.
      tools: [RECORD_TOOL],
      messages: [
        {
          role: 'user',
          content: [
            content,
            {
              type: 'text',
              text: `Student on file: ${student.name ?? 'unknown'}\nFile name: ${doc.originalName || doc.name || 'unknown'}\nRecord this document.`,
            },
          ],
        },
      ],
    });

    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'max_tokens') {
      return quickCard(nameType, name, 'error', 'The document was too long to record in one answer.');
    }
    if (!use) {
      const said = res.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
      return quickCard(nameType, name, 'error', `The model did not record the document. ${said}`.slice(0, 300));
    }
    const input = (use.input ?? {}) as Record<string, any>;
    const type = (DOC_TYPES as readonly string[]).includes(input.type) ? (input.type as DocType) : nameType;

    // A file that was not named as a passport can still turn out to be one. With passport
    // reading off, keep only what it is — not the number, birth date or expiry.
    const facts = type === 'passport' && !settings.readPassports ? {} : cleanFacts(input);

    return {
      version: CARD_VERSION,
      status: 'read',
      type,
      title: String(input.title || name).slice(0, 120),
      summary: String(input.summary || '').slice(0, 600),
      facts,
      nameOnDocument: input.nameOnDocument ?? null,
      matchesStudent: typeof input.matchesStudent === 'boolean' ? input.matchesStudent : null,
      readAt: new Date().toISOString(),
      model: AI_DOC_MODEL,
      via,
      usage: {
        inputTokens: res.usage.input_tokens ?? 0,
        outputTokens: res.usage.output_tokens ?? 0,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      },
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ...quickCard(nameType, name, 'error', reason.slice(0, 300)), via: undefined };
  }
}

/**
 * Store a card on its document. Done in a transaction against the current array, so an
 * upload or rename that lands while the model was reading is not overwritten.
 */
async function saveCard(studentId: string, docId: string, card: DocCard): Promise<boolean> {
  const ref = db().collection('students').doc(studentId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const docs: StoredDoc[] = (snap.data()?.documents as StoredDoc[]) ?? [];
    const i = docs.findIndex((d) => d.id === docId);
    if (i < 0) return false;
    const next = docs.slice();
    next[i] = { ...next[i], ai: card };
    tx.update(ref, { documents: next });
    return true;
  });
}

function needsReading(d: StoredDoc): boolean {
  if (!d.id) return false;
  if (!d.ai) return true;
  if (d.ai.version < CARD_VERSION) return true;
  return d.ai.status === 'error';
}

/** Read every unread document on one student. */
export async function readStudentDocuments(studentId: string, opts: { force?: boolean } = {}) {
  const snap = await db().collection('students').doc(studentId).get();
  if (!snap.exists) return { error: `No student found with id ${studentId}.` };
  const s = snap.data() ?? {};
  const settings = await getDocumentReaderSettings();
  const docs: StoredDoc[] = (s.documents as StoredDoc[]) ?? [];
  const todo = docs.filter((d) => d.id && (opts.force || needsReading(d)));
  const cards: Array<{ documentId: string; card: DocCard }> = [];
  for (const d of todo) {
    const card = await readDocument(d, { name: s.name }, settings);
    await saveCard(studentId, d.id!, card);
    cards.push({ documentId: d.id!, card });
  }
  return { studentId, read: cards.length, alreadyRead: docs.length - todo.length, cards };
}

/**
 * Work through unread documents across all open students, newest uploads first, until
 * `limit` documents have been read. Used by the scheduled sweep and the backfill.
 */
export async function readPendingDocuments(opts: { limit?: number; concurrency?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 500);
  const concurrency = Math.min(Math.max(opts.concurrency ?? 4, 1), 8);
  const settings = await getDocumentReaderSettings();
  const snap = await db().collection('students').select('name', 'documents', 'isClosed').get();

  const queue: Array<{ studentId: string; studentName: string; doc: StoredDoc }> = [];
  let pending = 0;
  for (const d of snap.docs) {
    const s = d.data();
    if (s.isClosed === true) continue;
    for (const doc of (s.documents as StoredDoc[]) ?? []) {
      if (!needsReading(doc)) continue;
      pending++;
      queue.push({ studentId: d.id, studentName: s.name, doc });
    }
  }
  queue.sort((a, b) => String(b.doc.uploadedAt ?? '').localeCompare(String(a.doc.uploadedAt ?? '')));
  const batch = queue.slice(0, limit);

  const totals = { read: 0, namedOnly: 0, unreadable: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  const byType: Record<string, number> = {};
  let next = 0;
  async function worker() {
    while (next < batch.length) {
      const item = batch[next++];
      const card = await readDocument(item.doc, { name: item.studentName }, settings);
      await saveCard(item.studentId, item.doc.id!, card).catch(() => false);
      if (card.status === 'read') totals.read++;
      else if (card.status === 'named_only') totals.namedOnly++;
      else if (card.status === 'unreadable') totals.unreadable++;
      else totals.errors++;
      byType[card.type] = (byType[card.type] ?? 0) + 1;
      totals.inputTokens += card.usage?.inputTokens ?? 0;
      totals.outputTokens += card.usage?.outputTokens ?? 0;
      totals.cacheReadTokens += card.usage?.cacheReadTokens ?? 0;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batch.length) }, worker));

  return { processed: batch.length, pendingBefore: pending, pendingAfter: pending - batch.length, ...totals, byType };
}

/** How far the reading has got, for the settings card. */
export async function documentReadingProgress() {
  const snap = await db().collection('students').select('documents', 'isClosed').get();
  let total = 0;
  let read = 0;
  let namedOnly = 0;
  let unreadable = 0;
  let errors = 0;
  const byType: Record<string, number> = {};
  for (const d of snap.docs) {
    if (d.data().isClosed === true) continue;
    for (const doc of (d.data().documents as StoredDoc[]) ?? []) {
      total++;
      if (!doc.ai) continue;
      if (doc.ai.status === 'read') read++;
      else if (doc.ai.status === 'named_only') namedOnly++;
      else if (doc.ai.status === 'unreadable') unreadable++;
      else errors++;
      byType[doc.ai.type] = (byType[doc.ai.type] ?? 0) + 1;
    }
  }
  return { total, read, namedOnly, unreadable, errors, notYetRead: total - read - namedOnly - unreadable - errors, byType };
}

/** The cards on one student, for the assistant: what each document is and says. */
export async function getStudentDocumentCards(studentId: string) {
  const snap = await db().collection('students').doc(studentId).get();
  if (!snap.exists) return { error: `No student found with id ${studentId}.` };
  const s = snap.data() ?? {};
  const docs: StoredDoc[] = (s.documents as StoredDoc[]) ?? [];
  return {
    studentId,
    studentName: s.name ?? null,
    count: docs.length,
    documents: docs.map((d) => ({
      documentId: d.id ?? null,
      name: d.name ?? d.originalName ?? null,
      uploadedAt: d.uploadedAt ?? null,
      ...(d.ai
        ? {
            type: d.ai.type,
            title: d.ai.title,
            summary: d.ai.summary,
            facts: d.ai.facts,
            nameOnDocument: d.ai.nameOnDocument ?? null,
            matchesStudent: d.ai.matchesStudent ?? null,
            readStatus: d.ai.status,
          }
        : { type: guessTypeFromName(`${d.name ?? ''} ${d.originalName ?? ''}`), readStatus: 'not yet read' }),
    })),
  };
}
