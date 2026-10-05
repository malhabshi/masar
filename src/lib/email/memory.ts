// The email memory: every email with or about a student, in and out, one line each.
//
// Each email is summarised once — who it was from, what it said, what it asked for, what
// it meant for the application — and kept in `email_memory`, keyed by its Message-ID so it
// is never stored twice. The assistant, the chat responder and the reply writer read a
// student's timeline from here instead of re-reading the mailbox, so they know what was
// offered, what was asked, and what the agency already sent.
//
// Sources:
//   - Incoming mail, as the intake files it.
//   - The agency's own replies, from Gmail's Sent folder (syncSentMail), so the memory
//     knows "we already sent the passport on 3 July".
//   - A one-off backfill from All Mail (backfillStudentEmails), per student.
//
// Read-only on the mailbox: mailboxes are opened with EXAMINE, nothing is flagged,
// moved or deleted.

import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow } from 'imapflow';
import { simpleParser, type ParsedMail } from 'mailparser';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';
import { loadStudentNames, matchStudentByName, type StudentNameRecord } from './matcher';
import { emailBodyText, newestMessage } from './text';
import { playbookBlock } from './companies';

export const EMAIL_MEMORY_COLLECTION = 'email_memory';
/** One doc per student whose older mail has been loaded (by the backfill or the one-off
 *  load), so it is never loaded — or paid for — twice. */
const LOADED_COLLECTION = 'email_memory_loaded';
const STATE_DOC = { collection: 'app_settings', doc: 'email_memory_state' };

export type EmailMemoryEntry = {
  studentId: string;
  studentName: string;
  direction: 'in' | 'out';
  date: string;
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  threadId: string | null;
  organisation: string | null;
  university: string | null;
  kind: string;
  summary: string;
  asks: string[];
  attachments: string[];
  recordedAt: string;
};

const KINDS = [
  'offer', 'cas', 'visa', 'rejection', 'application_received', 'request', 'reminder',
  'information', 'deposit_payment', 'acceptance', 'documents_sent', 'question', 'reply', 'other',
] as const;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

function imapClient(): ImapFlow | null {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!user || !pass) return null;
  return new ImapFlow({
    host: process.env.IMAP_HOST?.trim() || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT ?? '993'),
    secure: true,
    auth: { user, pass },
    logger: false,
  });
}

/** Firestore ids cannot contain "/"; Message-IDs often do. */
export function entryId(messageId: string | null, fallback: string): string {
  const raw = messageId ?? fallback;
  return raw.replace(/[^A-Za-z0-9._@+-]/g, '_').slice(0, 300);
}

// --------------------------------------------------------------------------
// Summarising one email
// --------------------------------------------------------------------------

const SYSTEM = `You keep a timeline of emails for a Kuwaiti study-abroad agency, one line per email, so staff and the AI can see a student's whole story at a glance. Call record_email once.

direction tells you whether the agency sent it ("out") or received it ("in"). Judge only the newest message given — earlier messages quoted in the thread are not included.
- summary: one short factual line, past tense, naming the university, e.g. "INTO UEA sent a conditional offer for the Foundation in Health Sciences; IELTS 6.0 required." or "Agency sent the passport and FGL to Merit for the Liverpool CAS."
- kind: the main thing the email is.
- university: the university the email is about, as named (or null).
- organisation: who sent it (for "in") or who it was sent to (for "out"), short.
- asks: anything the email asks for, short phrases; empty if nothing.`;

const TOOL: Anthropic.Tool = {
  name: 'record_email',
  description: 'Record this email in the timeline.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      kind: { type: 'string', enum: [...KINDS] },
      university: { type: ['string', 'null'] },
      organisation: { type: ['string', 'null'] },
      asks: { type: 'array', items: { type: 'string' } },
    },
    required: ['summary', 'kind'],
  },
};

async function summarise(input: {
  direction: 'in' | 'out';
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
  studentName: string;
}) {
  const res = await getAnthropicClient('email-memory').messages.create({
    model: AI_FAST_MODEL,
    max_tokens: 600,
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ...(await playbookBlock((input.direction === 'in' ? input.from : input.to).match(/[\w.+-]+@[\w.-]+/)?.[0] ?? '')),
    ],
    tools: [TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `Direction: ${input.direction}`,
          `Student: ${input.studentName}`,
          `From: ${input.from}`,
          `To: ${input.to}`,
          `Subject: ${input.subject}`,
          `Attachments: ${input.attachments.join(', ') || 'none'}`,
          '',
          newestMessage(input.body).slice(0, 5000) || '(no text)',
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const i = (use?.input ?? {}) as Record<string, any>;
  return {
    summary: String(i.summary ?? input.subject).slice(0, 400),
    kind: (KINDS as readonly string[]).includes(i.kind) ? String(i.kind) : 'other',
    university: typeof i.university === 'string' ? i.university : null,
    organisation: typeof i.organisation === 'string' ? i.organisation : null,
    asks: Array.isArray(i.asks) ? i.asks.filter((x: unknown): x is string => typeof x === 'string').slice(0, 10) : [],
  };
}

/** Store one email against a student, unless it is already there. Never throws. */
export async function rememberEmail(input: {
  studentId: string;
  studentName: string;
  direction: 'in' | 'out';
  date: string;
  from: string;
  to: string;
  subject: string;
  messageId: string | null;
  threadId?: string | null;
  body: string;
  attachments: string[];
}): Promise<'stored' | 'exists' | 'skipped'> {
  if (!isAiConfigured()) return 'skipped';
  try {
    const ref = db().collection(EMAIL_MEMORY_COLLECTION).doc(entryId(input.messageId, `${input.date}-${input.subject}`));
    if ((await ref.get()).exists) return 'exists';
    const s = await summarise(input);
    const entry: EmailMemoryEntry = {
      studentId: input.studentId,
      studentName: input.studentName,
      direction: input.direction,
      date: input.date,
      from: input.from,
      to: input.to,
      subject: input.subject,
      messageId: input.messageId,
      threadId: input.threadId ?? null,
      organisation: s.organisation,
      university: s.university,
      kind: s.kind,
      summary: s.summary,
      asks: s.asks,
      attachments: input.attachments.slice(0, 20),
      recordedAt: new Date().toISOString(),
    };
    await ref.set(entry);
    return 'stored';
  } catch (e) {
    console.error('[email-memory] could not store:', e);
    return 'skipped';
  }
}

// --------------------------------------------------------------------------
// Reading the memory
// --------------------------------------------------------------------------

/** A student's email timeline, newest first. Optionally only one university / sender. */
export async function getStudentEmailTimeline(studentId: string, opts: { filter?: string; limit?: number } = {}) {
  const snap = await db().collection(EMAIL_MEMORY_COLLECTION).where('studentId', '==', studentId).get();
  let rows = snap.docs.map((d) => ({ ...(d.data() as EmailMemoryEntry), ref: d.id }));
  if (opts.filter) {
    const f = opts.filter.toLowerCase();
    rows = rows.filter((r) =>
      [r.university, r.organisation, r.subject, r.summary, r.from, r.to].some((v) => String(v ?? '').toLowerCase().includes(f)),
    );
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 200);
  return {
    studentId,
    count: rows.length,
    shown: Math.min(rows.length, limit),
    timeline: rows.slice(0, limit).map((r) => ({
      // Names this one email, for applying it to the profile (applyPastEmail).
      ref: r.ref,
      date: r.date.slice(0, 10),
      direction: r.direction === 'in' ? 'received' : 'sent',
      with: r.organisation ?? (r.direction === 'in' ? r.from : r.to),
      university: r.university,
      kind: r.kind,
      summary: r.summary,
      asks: r.asks.length ? r.asks : undefined,
      attachments: r.attachments.length ? r.attachments : undefined,
      subject: r.subject,
    })),
  };
}

/**
 * Has this student's older mail been loaded? Asked instead of "is the memory empty": new
 * mail lands in the memory as it arrives, so a student with one new email would otherwise
 * never get the history from before it.
 */
export async function emailHistoryLoaded(studentId: string): Promise<boolean> {
  try {
    return (await db().collection(LOADED_COLLECTION).doc(studentId).get()).exists;
  } catch {
    return false;
  }
}

/** Compact lines for prompts: the last few emails with one organisation or on one thread. */
export async function recentEmailLines(studentId: string, filter?: string, limit = 8): Promise<string[]> {
  try {
    const t = await getStudentEmailTimeline(studentId, { filter, limit });
    return t.timeline.map((r) => `${r.date} ${r.direction} ${r.with ?? ''}: ${r.summary}`);
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------------
// Filling the memory from the mailbox
// --------------------------------------------------------------------------

type ParsedWithMeta = { parsed: ParsedMail; threadId: string | null };

function addressList(v: ParsedMail['to'] | ParsedMail['from']): string {
  if (!v) return '';
  const list = Array.isArray(v) ? v : [v];
  return list.map((x) => x.text).join(', ');
}

async function rememberParsed(
  { parsed, threadId }: ParsedWithMeta,
  direction: 'in' | 'out',
  students: StudentNameRecord[],
): Promise<'stored' | 'exists' | 'skipped' | 'unmatched'> {
  // Mail masar sends to staff (an IELTS course registration) is not mail with a school.
  if (parsed.headers.get('x-masar-internal')) return 'skipped';
  const body = emailBodyText(parsed);
  const match = matchStudentByName([parsed.subject ?? '', addressList(parsed.to), body].join('\n'), students);
  if (match.kind !== 'matched') return 'unmatched';
  return rememberEmail({
    studentId: match.student.id,
    studentName: match.student.name,
    direction,
    date: (parsed.date ?? new Date()).toISOString(),
    from: addressList(parsed.from),
    to: addressList(parsed.to),
    subject: parsed.subject ?? '',
    messageId: parsed.messageId ?? null,
    threadId,
    body,
    attachments: (parsed.attachments ?? []).filter((a) => a.contentDisposition !== 'inline').map((a) => a.filename ?? 'attachment'),
  });
}

/**
 * Pick up the agency's own sent replies since the last run. The first run only marks
 * where to start, so it does not walk years of Sent Mail; history comes from the backfill.
 */
export async function syncSentMail(opts: { limit?: number } = {}) {
  const result = { checked: 0, stored: 0, unmatched: 0 };
  const client = imapClient();
  if (!client || !isAiConfigured()) return result;
  const stateRef = db().collection(STATE_DOC.collection).doc(STATE_DOC.doc);
  const lastUid = Number((await stateRef.get()).data()?.lastSentUid ?? 0);

  await client.connect();
  try {
    const box = await client.mailboxOpen('[Gmail]/Sent Mail', { readOnly: true });
    const top = Number(box.uidNext ?? 1) - 1;
    if (!lastUid) {
      await stateRef.set({ lastSentUid: top, startedAt: new Date().toISOString() }, { merge: true });
      return result;
    }
    if (top <= lastUid) return result;
    const students = await loadStudentNames();
    const from = lastUid + 1;
    const to = Math.min(top, lastUid + (opts.limit ?? 40));
    let highest = lastUid;
    for await (const m of client.fetch(`${from}:${to}`, { source: true, threadId: true }, { uid: true })) {
      result.checked++;
      highest = Math.max(highest, m.uid);
      if (!m.source) continue;
      const parsed = await simpleParser(m.source);
      const r = await rememberParsed({ parsed, threadId: m.threadId ?? null }, 'out', students);
      if (r === 'stored') result.stored++;
      if (r === 'unmatched') result.unmatched++;
    }
    await stateRef.set({ lastSentUid: Math.max(highest, to) }, { merge: true });
  } finally {
    await client.logout().catch(() => {});
  }
  return result;
}

/**
 * Fill one student's memory from All Mail — everything with their name in it, both
 * directions. Safe to repeat: emails already remembered are skipped without a model call.
 */
export async function backfillStudentEmails(studentId: string, opts: { limit?: number } = {}) {
  const result = { found: 0, stored: 0, existed: 0, skipped: 0 };
  const client = imapClient();
  if (!client || !isAiConfigured()) return result;
  const snap = await db().collection('students').doc(studentId).get();
  const name = String(snap.data()?.name ?? '').replace(/-Closed$/, '').trim();
  if (!name) return result;
  const mailbox = (process.env.SMTP_USER ?? '').trim().toLowerCase();
  const students = await loadStudentNames();

  // The surname is the most distinctive search term IMAP's text search can use; the
  // full-name matcher then decides which student each email really belongs to.
  const surname = name.split(/\s+/).filter((w) => w.length > 2).pop() ?? name;

  await client.connect();
  try {
    await client.mailboxOpen('[Gmail]/All Mail', { readOnly: true });
    const uids = ((await client.search({ text: surname }, { uid: true })) || []).slice(-(opts.limit ?? 200));
    result.found = uids.length;
    // Download first, then summarise several at a time — one by one, a student with
    // fifty emails took minutes.
    const queue: Array<{ item: ParsedWithMeta; direction: 'in' | 'out' }> = [];
    for await (const m of uids.length ? client.fetch(uids.join(','), { source: true, threadId: true, flags: true }, { uid: true }) : []) {
      if (!m.source) continue;
      // Drafts live in All Mail too. An unsent draft is not something the agency said.
      if (m.flags?.has('\\Draft')) continue;
      const parsed = await simpleParser(m.source);
      const sender = parsed.from?.value?.[0]?.address?.toLowerCase() ?? '';
      if (/jotform\.com$/.test(sender)) continue; // form copies, already on the profile
      queue.push({ item: { parsed, threadId: m.threadId ?? null }, direction: sender === mailbox ? 'out' : 'in' });
    }
    await client.logout().catch(() => {});

    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const { item, direction } = queue[next++];
        const r = await rememberParsed(item, direction, students);
        if (r === 'stored') result.stored++;
        else if (r === 'exists') result.existed++;
        else result.skipped++;
      }
    };
    if (queue.length) await Promise.all(Array.from({ length: 6 }, worker));
    await db()
      .collection(LOADED_COLLECTION)
      .doc(studentId)
      .set({ loadedAt: new Date().toISOString(), via: 'backfill', found: result.found }, { merge: true })
      .catch(() => undefined);
  } finally {
    await client.logout().catch(() => {});
  }
  return result;
}
