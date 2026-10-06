// A renewed passport, passed on to the companies that need it — as Gmail drafts.
//
// When a passport is read that expires later than another passport on the profile, the
// student is queued here (autofill.ts). The scheduled job then drafts, in the existing email
// thread with each company, a short note with the new passport attached:
//   - the student has an FGL (the KCO's financial guarantee) for a school → only the company
//     that handles that school;
//   - no FGL → every company that handles one of the student's active applications.
// An FGL read later queues the student again, so the FGL school's company gets the passport
// if it has not had it yet. Each company gets it once (sentTo). Nothing is ever sent.
// A finalized student's chat is not told (quietWhenFinalized).

import nodemailer from 'nodemailer';
import { adminDb, storage } from '@/lib/firebase/admin';
import { isAiConfigured } from '@/lib/ai/config';
import { CHAT_BOT_USER_ID, ensureChatBotUser, quietWhenFinalized } from '@/lib/ai/chat-bot';
import { storagePathFromUrl } from '@/lib/mcp/document-tools';
import { sendChatMessage } from '@/lib/actions';
import { logAiAction } from '@/lib/ai/action-log';
import type { DocCard } from '@/lib/ai/documents';
import type { Application } from '@/lib/types';
import { appendDraft, isInboxConfigured } from './inbox';
import { backfillStudentEmails, EMAIL_MEMORY_COLLECTION, emailHistoryLoaded, type EmailMemoryEntry } from './memory';
import { pickThreads } from './followups';
import { universityWords } from './universities';

const COLLECTION = 'passport_renewals';
const BUCKET = 'studio-9484431255-91d96.firebasestorage.app';
const SIGNATURE = 'MMohammed';
const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** An FGL only brings an older renewal along if the passport came in recently. */
const RECENT_DAYS = 60;

type StoredDoc = { id?: string; name?: string; originalName?: string; url?: string; uploadedAt?: string; ai?: DocCard };
type Job = {
  studentId: string;
  passport: { docId: string; name: string; url: string; expiry: string };
  sentTo?: Record<string, { at: string; universities: string[] }>;
  pending: boolean;
  queuedAt: string;
  reason: string;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const isFgl = (d: StoredDoc) =>
  d.ai?.status === 'read' &&
  d.ai.matchesStudent !== false &&
  (d.ai.type === 'financial' || d.ai.type === 'mohe') &&
  /guarantee|ضمان|\bfgl\b|كفال/i.test(`${d.name ?? ''} ${d.ai.title} ${d.ai.summary}`);

/** The passport that renews an older one on file: the latest expiry, later than another passport's. */
export function renewedPassport(docs: StoredDoc[]): StoredDoc | null {
  const passports = docs.filter(
    (d) => d.ai?.status === 'read' && d.ai.type === 'passport' && d.ai.matchesStudent !== false && ISO.test(d.ai.facts?.expiryDate ?? ''),
  );
  if (passports.length < 2) return null;
  const sorted = [...passports].sort((a, b) => b.ai!.facts.expiryDate!.localeCompare(a.ai!.facts.expiryDate!));
  return sorted[0].ai!.facts.expiryDate! > sorted[sorted.length - 1].ai!.facts.expiryDate! ? sorted[0] : null;
}

/** A renewed passport was just read: queue the student. Never throws. */
export async function queuePassportRenewal(studentId: string, doc: StoredDoc, reason: string): Promise<void> {
  try {
    if (!doc.id || !doc.url || !ISO.test(doc.ai?.facts?.expiryDate ?? '')) return;
    const ref = db().collection(COLLECTION).doc(studentId);
    const before = (await ref.get()).data() as Job | undefined;
    // A different (newer) passport starts afresh: every company should get the new one.
    const samePassport = before?.passport?.docId === doc.id;
    await ref.set(
      {
        studentId,
        passport: { docId: doc.id, name: doc.name ?? 'Passport', url: doc.url, expiry: doc.ai!.facts.expiryDate! },
        sentTo: samePassport ? before?.sentTo ?? {} : {},
        pending: true,
        queuedAt: new Date().toISOString(),
        reason,
      },
      { merge: false },
    );
  } catch (e) {
    console.error('[passport-renewal] could not queue:', e);
  }
}

/** An FGL was just read: if there is a renewed passport, queue the student so its school's company gets it. */
export async function queueAfterFgl(studentId: string, docs: StoredDoc[]): Promise<void> {
  try {
    const ref = db().collection(COLLECTION).doc(studentId);
    const job = (await ref.get()).data() as Job | undefined;
    if (job) {
      await ref.set({ pending: true, queuedAt: new Date().toISOString(), reason: 'FGL received' }, { merge: true });
      return;
    }
    const renewed = renewedPassport(docs);
    if (renewed && Date.now() - new Date(renewed.uploadedAt ?? 0).getTime() < RECENT_DAYS * 86_400_000) {
      await queuePassportRenewal(studentId, renewed, 'FGL received');
    }
  } catch (e) {
    console.error('[passport-renewal] could not queue after FGL:', e);
  }
}

const kcoText = (d: StoredDoc) => ` ${`${d.ai!.facts.university ?? ''} ${d.ai!.title} ${d.ai!.summary}`.toLowerCase()} `;

/**
 * The applications a KCO letter is about. A school whose distinctive words all appear wins,
 * the most specific first ("Nottingham Trent" over "Nottingham"); failing that, a single
 * school with the most words in common. Anything less clear names no school.
 */
function schoolsIn(text: string, apps: Application[]): Application[] {
  const scored = apps.map((a) => {
    const words = [...universityWords(a.university)];
    return { a, size: words.length, hits: words.filter((w) => text.includes(w)).length };
  });
  const full = scored.filter((x) => x.size > 0 && x.hits === x.size);
  if (full.length) {
    const most = Math.max(...full.map((x) => x.size));
    return full.filter((x) => x.size === most).map((x) => x.a);
  }
  const best = Math.max(0, ...scored.map((x) => x.hits));
  const top = scored.filter((x) => best > 0 && x.hits === best);
  return top.length === 1 ? [top[0].a] : [];
}

/** The FGL's school(s); if the FGL names only a pathway college, the KCO approval letters help. */
function fglSchools(fgl: StoredDoc, kcoDocs: StoredDoc[], apps: Application[]): Application[] {
  const fromFgl = schoolsIn(kcoText(fgl), apps);
  return fromFgl.length ? fromFgl : schoolsIn(kcoDocs.map(kcoText).join(' '), apps);
}

const firstAddress = (s: string) => s.match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase() ?? '';

export type RenewalResult = { students: number; drafted: Array<{ student: string; to: string; universities: string[] }>; notes: string[] };

/** Draft the queued renewals. dryRun works out who would get what, and drafts nothing. */
export async function processPassportRenewals(opts: { limit?: number; dryRun?: boolean; studentId?: string } = {}): Promise<RenewalResult> {
  const result: RenewalResult = { students: 0, drafted: [], notes: [] };
  if (!isAiConfigured() || !isInboxConfigured()) return result;
  const mailbox = (process.env.SMTP_USER ?? '').trim().toLowerCase();
  const jobs = opts.studentId
    ? [(await db().collection(COLLECTION).doc(opts.studentId).get()).data() as Job | undefined].filter((j): j is Job => !!j)
    : ((await db().collection(COLLECTION).where('pending', '==', true).limit(opts.limit ?? 3).get()).docs.map((d) => d.data()) as Job[]);

  for (const job of jobs) {
    result.students++;
    const ref = db().collection(COLLECTION).doc(job.studentId);
    const finish = async (note: string) => {
      result.notes.push(note);
      if (!opts.dryRun) await ref.set({ pending: false, lastResult: note, lastRunAt: new Date().toISOString() }, { merge: true });
    };
    try {
      const s = (await db().collection('students').doc(job.studentId).get()).data();
      if (!s || s.isClosed === true) { await finish('student closed or missing'); continue; }
      const name = String(s.name ?? '');
      const docs = (s.documents ?? []) as StoredDoc[];
      const active = ((s.applications ?? []) as Application[]).filter((a) => a.status !== 'Rejected');

      // Which schools: the FGL's, else every active one.
      const fgl = docs.filter(isFgl).sort((a, b) => String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')))[0];
      const kcoDocs = docs.filter((d) => d.ai?.status === 'read' && d.ai.matchesStudent !== false && (d.ai.type === 'mohe' || d.ai.type === 'financial'));
      const fglApps = fgl ? fglSchools(fgl, kcoDocs, active) : [];
      const targets = fglApps.length ? fglApps : active;
      const why = fglApps.length ? `FGL for ${fglApps[0].university}` : fgl ? 'FGL school not among the applications — all active schools' : 'no FGL — all active schools';
      if (!targets.length) { await finish(`${name}: no active applications`); continue; }

      // Their email threads, as the follow-ups find them.
      if (!(await emailHistoryLoaded(job.studentId))) await backfillStudentEmails(job.studentId, { limit: 80 }).catch(() => undefined);
      const emails = (await db().collection(EMAIL_MEMORY_COLLECTION).where('studentId', '==', job.studentId).get()).docs
        .map((d) => d.data() as EmailMemoryEntry)
        .filter((e) => e.messageId)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40);
      const picks = emails.length ? await pickThreads(targets, emails) : new Map<number, number>();
      const groups = new Map<string, { email: EmailMemoryEntry; universities: string[] }>();
      const noThread: string[] = [];
      targets.forEach((a, i) => {
        const e = picks.has(i) ? emails[picks.get(i)!] : undefined;
        const partner = e ? (e.direction === 'in' ? firstAddress(e.from) : firstAddress(e.to)) : '';
        if (!e || !partner || partner === mailbox) { noThread.push(a.university); return; }
        const g = groups.get(partner) ?? { email: e, universities: [] };
        g.universities.push(a.university);
        groups.set(partner, g);
      });

      const sentTo = { ...(job.sentTo ?? {}) };
      const todo = [...groups.entries()].filter(([partner]) => !sentTo[partner]);
      if (!todo.length) {
        // Nothing to draft because no email thread exists: tell staff, so it is sent by hand.
        if (!groups.size && noThread.length && !opts.dryRun && !(await quietWhenFinalized(job.studentId))) {
          await ensureChatBotUser();
          await sendChatMessage(
            job.studentId,
            CHAT_BOT_USER_ID,
            `📎 Renewed passport (valid until ${job.passport.expiry}) — no email thread found with the company for ${noThread.join(', ')}. Please send it there yourself.`,
            ['admins'],
          ).catch(() => undefined);
        }
        await finish(`${name}: ${why}; ${groups.size ? 'already sent to every company' : 'no email thread found'}${noThread.length ? ` (no thread: ${noThread.join(', ')})` : ''}`);
        continue;
      }
      if (opts.dryRun) {
        for (const [partner, g] of todo) result.drafted.push({ student: name, to: `${partner} — "${g.email.subject}"`, universities: g.universities });
        result.notes.push(`${name}: ${why}`);
        continue;
      }

      const path = storagePathFromUrl(job.passport.url, BUCKET);
      if (!path || !storage) { await finish(`${name}: passport file not found in storage`); continue; }
      const [bytes] = await storage.bucket(BUCKET).file(path).download();
      const ext = (path.match(/\.([A-Za-z0-9]{2,5})$/)?.[1] ?? 'pdf').toLowerCase();
      const filename = `Passport - ${name}.${ext}`;

      const drafted: string[] = [];
      let failed = 0;
      for (const [partner, g] of todo) {
        const org = g.email.organisation ?? partner.split('@')[1];
        const body = [
          `Dear ${org} Team,`,
          '',
          `Please find attached the renewed passport of ${name} (valid until ${job.passport.expiry}). Kindly update your records${fglApps.length ? ' and the CAS' : ''} for ${g.universities.join(', ')}.`,
          '',
          'Kind regards,',
          SIGNATURE,
        ].join('\n');
        const subject = /^re:/i.test(g.email.subject) ? g.email.subject : `Re: ${g.email.subject}`;
        const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
          from: process.env.SMTP_USER,
          to: partner,
          subject,
          text: body,
          inReplyTo: g.email.messageId!,
          references: [g.email.messageId!],
          attachments: [{ filename, content: bytes }],
        });
        const saved = await appendDraft(built.message as Buffer);
        if (!saved.ok) { failed++; result.notes.push(`${name}: could not save the draft to ${partner} (${saved.error})`); continue; }
        sentTo[partner] = { at: new Date().toISOString(), universities: g.universities };
        drafted.push(`${org} (${g.universities.join(', ')})`);
        result.drafted.push({ student: name, to: partner, universities: g.universities });
      }
      // A draft that could not be saved is tried again on the next run.
      await ref.set({ sentTo, pending: failed > 0, lastResult: `${why}; drafted to ${drafted.join(' · ') || 'nobody'}`, lastRunAt: new Date().toISOString() }, { merge: true });
      if (drafted.length) {
        await logAiAction({
          source: 'document',
          summary: `Renewed passport drafted in Gmail to ${drafted.join(' · ')}`,
          reason: `Passport valid until ${job.passport.expiry} (${why})`,
          studentId: job.studentId,
          studentName: name,
          undo: { type: 'none' },
        });
      }
      if (drafted.length && !(await quietWhenFinalized(job.studentId))) {
        await ensureChatBotUser();
        await sendChatMessage(
          job.studentId,
          CHAT_BOT_USER_ID,
          `📎 Renewed passport (valid until ${job.passport.expiry}) — emails with it attached are waiting in Gmail Drafts to ${drafted.join(' · ')}.${noThread.length ? ` No email thread found for ${noThread.join(', ')} — please send it there yourself.` : ''}`,
          ['admins'],
        ).catch(() => undefined);
      }
    } catch (e) {
      result.notes.push(`${job.studentId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}
