// Chasing applications that were submitted and have heard nothing back.
//
// An application Submitted for 5 days with no offer gets a short "could you please give
// us an update" reply DRAFTED in the conversation with the company that handles it —
// Merit, INTO, Study Group… — found from the student's email memory. One draft covers
// every waiting application on the same conversation. Nothing is sent.
//
// Limits, so the first run does not flood Drafts with a backlog of stale records:
//   - only applications that became Submitted between 5 and 60 days ago; older ones are
//     listed for a person to check, since they are usually a status nobody updated;
//   - at most DAILY_CAP drafts per run;
//   - not when the company wrote about the student in the last 5 days;
//   - the same application is chased again only after another 5 days without news;
//   - when the student has a final choice, only that school is chased — the others are not
//     where the student is going;
//   - never an application staff asked to stop chasing (stopFollowUp, from the chat);
//   - never an application whose emails already hold the decision: the history loaded
//     before the intake began has offers that never reached the profile. That email is
//     applied instead (applyPastEmail) — or, when it changes nothing, a person is asked.

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';
import { CHAT_BOT_USER_ID, ensureChatBotUser } from '@/lib/ai/chat-bot';
import { sendChatMessage } from '@/lib/actions';
import { appendDraft, isInboxConfigured } from './inbox';
import { backfillStudentEmails, EMAIL_MEMORY_COLLECTION, emailHistoryLoaded, entryId, type EmailMemoryEntry } from './memory';
import { replyWithReceipt } from './reply-receipt';
import type { Application } from '@/lib/types';
import { AI_ACTIONS_COLLECTION, logAiAction, type AiAction } from '@/lib/ai/action-log';
import { notifyEmployeeOfStatus } from '@/lib/applications/set-status';
import { FieldValue } from 'firebase-admin/firestore';
import { sameUniversity } from './universities';
import { applyPastEmail, type PastEmailResult } from './past-email';

const FOLLOWUP_COLLECTION = 'email_followups';
const WAIT_DAYS = 5;
const MAX_AGE_DAYS = 60;
const DAILY_CAP = 15;
/** Loading a student's mail history takes ~40s; a run loads at most this many. */
const MAX_HISTORY_LOADS = 4;
/** Stop starting new students after this long, so the run finishes inside its time limit. */
const TIME_BUDGET_MS = 200_000;
const DRAFT_SIGNATURE = 'MMohammed';
const DAY = 86_400_000;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const appKey = (studentId: string, a: Application) =>
  `${studentId}__${a.university}__${a.major}`.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 300);

const firstAddress = (s: string) => s.match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase() ?? '';

type Waiting = { app: Application; days: number; key: string };

/**
 * With a final choice set, only that school's applications are chased. Matched by exact
 * name, then by the same distinctive words ("University of Liverpool - kaplan" = "University
 * of Liverpool") — never by one shared word, which would make East London East Anglia. A
 * final choice that matches none of the applications means nothing is chased.
 */
function finalChoiceFilter(final: unknown, apps: Application[]): ((a: Application) => boolean) | null {
  if (typeof final !== 'string' || !final.trim()) return null;
  const plain = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ');
  // Exact name first: a general name ("University of London") has no distinctive words left.
  const exact = apps.filter((a) => plain(a.university) === plain(final));
  const strict = exact.length ? exact : apps.filter((a) => sameUniversity(final, a.university));
  return (a) => strict.includes(a);
}

/**
 * Is chasing stopped? Each stop request adds its id to stopIds and its Undo removes only
 * that id, so requests and Undos can come in any order. A stop saved before ids existed has
 * only stoppedAt.
 */
export function followUpStopped(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return Array.isArray(data?.stopIds) ? data!.stopIds.length > 0 : !!data?.stoppedAt;
}

/**
 * Stop chasing one application — and, when the student chose another school or withdrew,
 * set it to Rejected — together with its AI Activity entry, in ONE transaction: there is
 * never a stop without its Undo, or a rejection of an application staff have meanwhile
 * marked Accepted (Accepted and Rejected are never replaced). The employee is notified
 * after the commit.
 */
export async function stopFollowUpWithUndo(input: {
  studentId: string;
  university: string;
  major: string;
  /** Set when the application should also become Rejected, with this reason. */
  rejectionReason: string | null;
  stopReason: string;
  by: string;
  /** For the AI Activity entry. */
  logReason: string;
}): Promise<{ ok: true; status: string; draft: { to: string | null; lastDraftedAt: string | null } } | { ok: false; error: string }> {
  const studentRef = db().collection('students').doc(input.studentId);
  const actionRef = db().collection(AI_ACTIONS_COLLECTION).doc();
  const stopId = `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date().toISOString();

  const r = await db().runTransaction(async (tx) => {
    const s = (await tx.get(studentRef)).data();
    if (!s) return { ok: false as const, error: 'Student not found.' };
    const apps = (s.applications ?? []) as Application[];
    const i = apps.findIndex((a) => a.university === input.university && a.major === input.major);
    if (i < 0) return { ok: false as const, error: 'That application is no longer on the profile.' };
    const app = apps[i];
    const key = appKey(input.studentId, app);
    const ref = db().collection(FOLLOWUP_COLLECTION).doc(key);
    const before = (await tx.get(ref)).data() ?? {};

    const reject = !!input.rejectionReason && app.status !== 'Accepted' && app.status !== 'Rejected';
    const nextApps = reject
      ? apps.map((a, k) => (k === i ? { ...a, status: 'Rejected' as const, rejectionReason: input.rejectionReason!, updatedAt: now } : a))
      : apps;

    tx.set(
      ref,
      {
        studentId: input.studentId,
        university: app.university,
        major: app.major,
        stoppedAt: now,
        stoppedBy: input.by,
        stopReason: input.stopReason,
        // An older stop saved without ids keeps a place of its own, so this Undo cannot lift it.
        stopIds: before.stoppedAt && !Array.isArray(before.stopIds) ? FieldValue.arrayUnion('earlier', stopId) : FieldValue.arrayUnion(stopId),
      },
      { merge: true },
    );
    if (reject) tx.update(studentRef, { applications: nextApps, lastActivityAt: now });
    const stopUndo = { key, stopId };
    const entry: AiAction = {
      id: actionRef.id,
      at: now,
      source: 'chat',
      summary: `${app.university}: follow-ups stopped${reject ? `; ${app.status} → Rejected (${input.rejectionReason})` : ''}`,
      reason: input.logReason,
      studentId: input.studentId,
      studentName: (s.name as string) ?? null,
      undo: reject
        ? {
            type: 'app_status',
            university: app.university,
            major: app.major,
            from: app.status,
            to: 'Rejected',
            rejectionReason: app.rejectionReason ?? null,
            setAt: now,
            followUpStop: stopUndo,
          }
        : { type: 'resume_follow_up', ...stopUndo },
    };
    tx.set(actionRef, JSON.parse(JSON.stringify(entry)));
    return {
      ok: true as const,
      status: reject ? `${app.status} → Rejected (${input.rejectionReason})` : `unchanged (${app.status})`,
      draft: { to: (before.to as string | undefined) ?? null, lastDraftedAt: (before.lastDraftedAt as string | undefined) ?? null },
      notify: reject ? { studentName: String(s.name ?? ''), employeeId: (s.employeeId as string | undefined) ?? null, applications: nextApps } : null,
    };
  });
  if (!r.ok) return r;
  if (r.notify) {
    await notifyEmployeeOfStatus({ studentId: input.studentId, university: input.university, to: 'Rejected', ...r.notify });
  }
  return { ok: true, status: r.status, draft: r.draft };
}


const PICK_SYSTEM = `You match a student's submitted university applications to the email conversation through which each one is handled, for a Kuwaiti study-abroad agency. Applications go through agents and pathway providers (Merit handles Kaplan, OnCampus and others; INTO, Study Group and Navitas run their own centres) or direct to a university. Call record_threads once. For each application give the number of the email in the list that belongs to the conversation handling it (prefer the most recent email of that conversation), or null if none of the emails is about it. Also give "decision": the number of an email RECEIVED that already gives the university's decision on that application — an offer (conditional or unconditional), a rejection, or a CAS — or null when none does. University names in the applications are sometimes misspelt ("Striling" is Stirling). Never guess.`;

const PICK_TOOL: Anthropic.Tool = {
  name: 'record_threads',
  description: 'Which email conversation handles each application.',
  input_schema: {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            app: { type: 'integer' },
            email: { type: ['integer', 'null'] },
            decision: { type: ['integer', 'null'] },
          },
          required: ['app', 'email', 'decision'],
        },
      },
    },
    required: ['picks'],
  },
};

/** Which email conversation handles each application (index into emails). Also used for renewed passports. */
export async function pickThreads(apps: Application[], emails: EmailMemoryEntry[]): Promise<Map<number, number>> {
  return (await pickThreadsAndDecisions(apps, emails)).threads;
}

/** An offer, a rejection or a CAS, by the memory's own reading of the email. */
const DECISION_KINDS = new Set(['offer', 'rejection', 'cas']);
const DECISION_WORDS = /\boffer\b|unsuccessful|reject|regret|\bCAS\b|unable to offer/i;

/** As pickThreads, and which received email (if any) already gives each application's decision. */
export async function pickThreadsAndDecisions(
  apps: Application[],
  emails: EmailMemoryEntry[],
): Promise<{ threads: Map<number, number>; decisions: Map<number, number> }> {
  const res = await getAnthropicClient('follow-ups').messages.create({
    model: AI_FAST_MODEL,
    max_tokens: 800,
    system: PICK_SYSTEM,
    tools: [PICK_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          'Applications:',
          ...apps.map((a, i) => `${i}. ${a.university} — ${a.major} (${a.country})`),
          '',
          'Emails (newest first):',
          ...emails.map(
            (e, i) =>
              `${i}. ${e.date.slice(0, 10)} ${e.direction === 'in' ? `from ${e.from}` : `to ${e.to}`} | ${e.kind} | ${e.subject} | ${e.summary}`,
          ),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const threads = new Map<number, number>();
  const decisions = new Map<number, number>();
  for (const p of ((use?.input as any)?.picks ?? []) as Array<{ app: number; email: number | null; decision: number | null }>) {
    if (!Number.isInteger(p.app) || !apps[p.app]) continue;
    if (Number.isInteger(p.email) && emails[p.email!]) threads.set(p.app, p.email!);
    // The model's word alone is not enough: the email must read as a decision too, and come
    // after the application was submitted — an older one is about an earlier round.
    const d = Number.isInteger(p.decision) ? emails[p.decision!] : undefined;
    const submittedAt = apps[p.app].updatedAt ?? '';
    if (
      d &&
      d.direction === 'in' &&
      d.date >= submittedAt &&
      (DECISION_KINDS.has(d.kind) || DECISION_WORDS.test(`${d.subject} ${d.summary}`))
    ) {
      decisions.set(p.app, p.decision!);
    }
  }
  return { threads, decisions };
}

export type FollowUpResult = {
  drafted: Array<{ student: string; to: string; applications: string[] }>;
  noConversation: Array<{ student: string; application: string }>;
  tooOld: number;
  /** Not chased: the student's final choice is another school. */
  notFinalChoice: number;
  /** Not chased: staff asked to stop. */
  stopped: number;
  /** Not chased: an earlier email held the decision, now applied. */
  decidedByEmail: Array<{ student: string; application: string; status: string; email: string }>;
  /** Not chased: an earlier email looks like a decision but changed nothing — a person was asked. */
  needsCheck: Array<{ student: string; application: string; email: string }>;
  capped: boolean;
  errors: string[];
};

export async function followUpSubmittedApplications(opts: { cap?: number; dryRun?: boolean } = {}): Promise<FollowUpResult> {
  const result: FollowUpResult = {
    drafted: [],
    noConversation: [],
    tooOld: 0,
    notFinalChoice: 0,
    stopped: 0,
    decidedByEmail: [],
    needsCheck: [],
    capped: false,
    errors: [],
  };
  const started = Date.now();
  let historyLoads = 0;
  if (!isAiConfigured() || !isInboxConfigured()) return result;
  const cap = opts.cap ?? DAILY_CAP;
  const now = Date.now();
  const mailbox = (process.env.SMTP_USER ?? '').trim().toLowerCase();

  // Every open student's applications that have waited long enough.
  const snap = await db().collection('students').select('name', 'applications', 'isClosed', 'employeeId', 'finalChoiceUniversity').get();
  const candidates: Array<{ id: string; name: string; employeeId: string | null; waiting: Waiting[] }> = [];
  for (const d of snap.docs) {
    const s = d.data();
    if (s.isClosed === true) continue;
    const waiting: Waiting[] = [];
    const isFinalChoice = finalChoiceFilter(s.finalChoiceUniversity, (s.applications ?? []) as Application[]);
    for (const a of (s.applications ?? []) as Application[]) {
      if (a.status !== 'Submitted' || !a.updatedAt) continue;
      if (isFinalChoice && !isFinalChoice(a)) {
        result.notFinalChoice++;
        continue;
      }
      const days = Math.floor((now - new Date(a.updatedAt).getTime()) / DAY);
      if (days < WAIT_DAYS) continue;
      if (days > MAX_AGE_DAYS) {
        result.tooOld++;
        continue;
      }
      waiting.push({ app: a, days, key: appKey(d.id, a) });
    }
    if (waiting.length) candidates.push({ id: d.id, name: s.name, employeeId: s.employeeId ?? null, waiting });
  }
  // Longest wait first.
  candidates.sort((a, b) => Math.max(...b.waiting.map((w) => w.days)) - Math.max(...a.waiting.map((w) => w.days)));

  for (const student of candidates) {
    if (result.drafted.length >= cap || Date.now() - started > TIME_BUDGET_MS) {
      result.capped = true;
      break;
    }
    try {
      // Skip applications chased in the last WAIT_DAYS.
      const states = await Promise.all(student.waiting.map((w) => db().collection(FOLLOWUP_COLLECTION).doc(w.key).get()));
      const due = student.waiting.filter((w, i) => {
        if (followUpStopped(states[i].data())) {
          result.stopped++;
          return false;
        }
        const last = states[i].data()?.lastDraftedAt;
        return !last || now - new Date(last).getTime() >= WAIT_DAYS * DAY;
      });
      if (!due.length) continue;

      // The student's conversations; load them from the mailbox if never loaded.
      let emails = (await db().collection(EMAIL_MEMORY_COLLECTION).where('studentId', '==', student.id).get()).docs.map(
        (d) => d.data() as EmailMemoryEntry,
      );
      if (!(await emailHistoryLoaded(student.id))) {
        // Left for a later run rather than blowing this one's time limit.
        if (historyLoads >= MAX_HISTORY_LOADS) continue;
        historyLoads++;
        await backfillStudentEmails(student.id, { limit: 80 });
        emails = (await db().collection(EMAIL_MEMORY_COLLECTION).where('studentId', '==', student.id).get()).docs.map(
          (d) => d.data() as EmailMemoryEntry,
        );
      }
      emails = emails.filter((e) => e.messageId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
      if (!emails.length) {
        due.forEach((w) => result.noConversation.push({ student: student.name, application: w.app.university }));
        continue;
      }

      const { threads: picks, decisions } = await pickThreadsAndDecisions(due.map((w) => w.app), emails);

      // The decision is already in the emails: apply that email instead of chasing.
      const stateOf = new Map(student.waiting.map((w, i) => [w.key, states[i].data()] as const));
      const applied = new Map<string, PastEmailResult>();
      for (const [i, d] of decisions) {
        const w = due[i];
        const e = emails[d];
        const ref = entryId(e.messageId, `${e.date}-${e.subject}`);
        const label = `${e.date.slice(0, 10)} "${e.subject}"`;
        if (opts.dryRun) {
          result.decidedByEmail.push({ student: student.name, application: w.app.university, status: '(dry run)', email: label });
          continue;
        }
        // Already applied once and a person asked: leave it with them.
        if (stateOf.get(w.key)?.decisionRef === ref) continue;
        if (!applied.has(ref)) applied.set(ref, await applyPastEmail({ studentId: student.id, ref, by: 'follow-ups' }));
        const r = applied.get(ref)!;
        // Gmail or the model failed: not chased this time, and tried again on the next run.
        if (!r.ok) {
          result.errors.push(`${student.name}: ${w.app.university}: ${r.error}`);
          continue;
        }
        const fresh = ((await db().collection('students').doc(student.id).get()).data()?.applications ?? []) as Application[];
        const current = fresh.find((a) => a.university === w.app.university && a.major === w.app.major);
        await db()
          .collection(FOLLOWUP_COLLECTION)
          .doc(w.key)
          .set({ studentId: student.id, university: w.app.university, major: w.app.major, decisionRef: ref, decisionCheckedAt: new Date().toISOString() }, { merge: true });
        if (current && current.status !== 'Submitted') {
          result.decidedByEmail.push({ student: student.name, application: w.app.university, status: current.status, email: label });
          continue;
        }
        // It reads as a decision but changed nothing: a person decides, and it is not chased.
        result.needsCheck.push({ student: student.name, application: w.app.university, email: label });
        const why =
          r.changes.find((c) => c.university === w.app.university && c.major === w.app.major)?.note ??
          'the email did not say which application it decides';
        await ensureChatBotUser();
        await sendChatMessage(
          student.id,
          CHAT_BOT_USER_ID,
          `⚠️ ${e.organisation ?? e.from} emailed on ${e.date.slice(0, 10)} ("${e.subject}") what looks like a decision on ${w.app.university} (${w.app.major}), but its status was not changed automatically — ${why}. It will not be chased; please check it and set the status.`,
          ['admins'],
        ).catch(() => undefined);
      }

      // Group by conversation partner, so one email asks about all of them.
      const groups = new Map<string, { email: EmailMemoryEntry; items: Waiting[] }>();
      due.forEach((w, i) => {
        if (decisions.has(i)) return;
        const e = picks.has(i) ? emails[picks.get(i)!] : undefined;
        if (!e) {
          result.noConversation.push({ student: student.name, application: w.app.university });
          return;
        }
        const partner = e.direction === 'in' ? firstAddress(e.from) : firstAddress(e.to);
        if (!partner || partner === mailbox) {
          result.noConversation.push({ student: student.name, application: w.app.university });
          return;
        }
        const g = groups.get(partner) ?? { email: e, items: [] };
        g.items.push(w);
        groups.set(partner, g);
      });

      for (const [partner, g] of groups) {
        if (result.drafted.length >= cap) {
          result.capped = true;
          break;
        }
        // They wrote about this student recently: no need to chase.
        const heardRecently = emails.some(
          (e) => e.direction === 'in' && firstAddress(e.from) === partner && now - new Date(e.date).getTime() < WAIT_DAYS * DAY,
        );
        if (heardRecently) continue;

        // Re-check just before drafting: staff may have stopped one in the chat, or its status
        // moved on, while this run was loading mail and asking the model.
        if (!opts.dryRun) {
          const [fresh, ...stops] = await Promise.all([
            db().collection('students').doc(student.id).get(),
            ...g.items.map((w) => db().collection(FOLLOWUP_COLLECTION).doc(w.key).get()),
          ]);
          const apps = (fresh.data()?.applications ?? []) as Application[];
          const stillFinal = finalChoiceFilter(fresh.data()?.finalChoiceUniversity, apps);
          g.items = g.items.filter((w, k) => {
            const current = apps.find((a) => a.university === w.app.university && a.major === w.app.major);
            return !followUpStopped(stops[k].data()) && current?.status === 'Submitted' && (!stillFinal || stillFinal(current));
          });
          if (!g.items.length) continue;
        }

        const org = g.email.organisation ?? partner.split('@')[1];
        const list = g.items.map((w) => `${w.app.university} (${w.app.major})`);
        if (opts.dryRun) {
          result.drafted.push({ student: student.name, to: `${partner} — "${g.email.subject}"`, applications: list });
          continue;
        }
        const body = [
          `Dear ${org} Team,`,
          '',
          list.length === 1
            ? `Could you please provide an update on the application to ${list[0]}?`
            : `Could you please provide an update on the following applications?\n${list.map((l) => `- ${l}`).join('\n')}`,
          '',
          'Kind regards,',
          DRAFT_SIGNATURE,
        ].join('\n');
        const subject = /^re:/i.test(g.email.subject) ? g.email.subject : `Re: ${g.email.subject}`;
        const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
          from: process.env.SMTP_USER,
          to: partner,
          subject,
          text: body,
          inReplyTo: g.email.messageId!,
          references: [g.email.messageId!],
        });
        const saved = await appendDraft(built.message as Buffer);
        if (!saved.ok) throw new Error(saved.error ?? 'Could not save the draft.');

        const at = new Date().toISOString();
        await Promise.all(
          g.items.map((w) =>
            db().collection(FOLLOWUP_COLLECTION).doc(w.key).set(
              { studentId: student.id, university: w.app.university, major: w.app.major, to: partner, lastDraftedAt: at },
              { merge: true },
            ),
          ),
        );
        result.drafted.push({ student: student.name, to: partner, applications: list });
        await logAiAction({
          source: 'followup',
          summary: `Update request drafted in Gmail to ${org}: ${list.join(' · ')}`,
          reason: `Submitted ${Math.max(...g.items.map((w) => w.days))} days ago with no offer`,
          studentId: student.id,
          studentName: student.name,
          undo: { type: 'none' },
        });

        await replyWithReceipt(
          { uid: 0, messageId: g.email.messageId, from: partner, fromName: org, subject: g.email.subject, date: g.email.date, text: '', attachments: [] },
          {
            kind: 'drafted',
            studentId: student.id,
            studentName: student.name,
            to: partner,
            answered: [`Update request — submitted ${Math.max(...g.items.map((w) => w.days))} days ago, no offer yet: ${list.join(' · ')}`],
            attachments: [],
            stillWaiting: [],
          },
        ).catch(() => undefined);
        // Stopped in the chat while this draft was being written? Say so, so it is not sent.
        const stoppedMeanwhile = (
          await Promise.all(g.items.map((w) => db().collection(FOLLOWUP_COLLECTION).doc(w.key).get()))
        ).some((d) => followUpStopped(d.data()));
        await ensureChatBotUser();
        await sendChatMessage(
          student.id,
          CHAT_BOT_USER_ID,
          stoppedMeanwhile
            ? `⚠️ An email asking ${org} for an update was saved in Gmail Drafts just as chasing was stopped (${list.join(' · ')}). Please delete that draft — do not send it.`
            : `⏳ No offer yet after ${Math.max(...g.items.map((w) => w.days))} days — an email asking ${org} for an update is waiting in Gmail Drafts: ${list.join(' · ')}`,
          ['admins'],
        ).catch(() => undefined);
      }
    } catch (e) {
      result.errors.push(`${student.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/** Run at most once a day from the five-minute cron. */
export async function followUpsIfDue(): Promise<FollowUpResult | { skipped: string }> {
  const ref = db().collection('app_settings').doc('email_followups_state');
  const last = (await ref.get()).data()?.lastRunAt;
  if (last && Date.now() - new Date(last).getTime() < 20 * 3_600_000) return { skipped: 'already ran today' };
  await ref.set({ lastRunAt: new Date().toISOString() }, { merge: true });
  return followUpSubmittedApplications();
}
