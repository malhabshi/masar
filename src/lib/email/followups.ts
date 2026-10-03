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
//   - never an application staff asked to stop chasing (stopFollowUp, from the chat).

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';
import { CHAT_BOT_USER_ID, ensureChatBotUser } from '@/lib/ai/chat-bot';
import { sendChatMessage } from '@/lib/actions';
import { appendDraft, isInboxConfigured } from './inbox';
import { backfillStudentEmails, EMAIL_MEMORY_COLLECTION, emailHistoryLoaded, type EmailMemoryEntry } from './memory';
import { replyWithReceipt } from './reply-receipt';
import type { Application } from '@/lib/types';
import { logAiAction } from '@/lib/ai/action-log';
import { overlapsUniversity, sameUniversity } from './universities';

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
 * With a final choice set, only that school's applications are chased. Matched strictly
 * first, then loosely (the final choice is typed by hand); if it matches none of the
 * applications, nothing is filtered out.
 */
function finalChoiceFilter(final: unknown, apps: Application[]): ((a: Application) => boolean) | null {
  if (typeof final !== 'string' || !final.trim()) return null;
  const strict = apps.filter((a) => sameUniversity(final, a.university));
  const chosen = strict.length ? strict : apps.filter((a) => overlapsUniversity(final, a.university));
  return chosen.length ? (a) => chosen.includes(a) : null;
}

/**
 * Stop chasing one application — staff said so in the chat (the student chose another
 * school, withdrew, or it should simply not be chased). Returns the last draft on record,
 * so staff can be told which one to delete.
 */
export async function stopFollowUp(
  studentId: string,
  app: Application,
  stop: { reason: string; by: string },
): Promise<{ to: string | null; lastDraftedAt: string | null }> {
  const ref = db().collection(FOLLOWUP_COLLECTION).doc(appKey(studentId, app));
  const before = (await ref.get()).data() ?? {};
  await ref.set(
    { studentId, university: app.university, major: app.major, stoppedAt: new Date().toISOString(), stoppedBy: stop.by, stopReason: stop.reason },
    { merge: true },
  );
  return { to: before.to ?? null, lastDraftedAt: before.lastDraftedAt ?? null };
}

const PICK_SYSTEM = `You match a student's submitted university applications to the email conversation through which each one is handled, for a Kuwaiti study-abroad agency. Applications go through agents and pathway providers (Merit handles Kaplan, OnCampus and others; INTO, Study Group and Navitas run their own centres) or direct to a university. Call record_threads once. For each application give the number of the email in the list that belongs to the conversation handling it (prefer the most recent email of that conversation), or null if none of the emails is about it. Never guess.`;

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
          properties: { app: { type: 'integer' }, email: { type: ['integer', 'null'] } },
          required: ['app', 'email'],
        },
      },
    },
    required: ['picks'],
  },
};

async function pickThreads(apps: Application[], emails: EmailMemoryEntry[]): Promise<Map<number, number>> {
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
              `${i}. ${e.date.slice(0, 10)} ${e.direction === 'in' ? `from ${e.from}` : `to ${e.to}`} | ${e.subject} | ${e.summary}`,
          ),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const out = new Map<number, number>();
  for (const p of ((use?.input as any)?.picks ?? []) as Array<{ app: number; email: number | null }>) {
    if (Number.isInteger(p.app) && Number.isInteger(p.email) && apps[p.app] && emails[p.email!]) out.set(p.app, p.email!);
  }
  return out;
}

export type FollowUpResult = {
  drafted: Array<{ student: string; to: string; applications: string[] }>;
  noConversation: Array<{ student: string; application: string }>;
  tooOld: number;
  /** Not chased: the student's final choice is another school. */
  notFinalChoice: number;
  /** Not chased: staff asked to stop. */
  stopped: number;
  capped: boolean;
  errors: string[];
};

export async function followUpSubmittedApplications(opts: { cap?: number; dryRun?: boolean } = {}): Promise<FollowUpResult> {
  const result: FollowUpResult = { drafted: [], noConversation: [], tooOld: 0, notFinalChoice: 0, stopped: 0, capped: false, errors: [] };
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
        if (states[i].data()?.stoppedAt) {
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

      const picks = await pickThreads(due.map((w) => w.app), emails);
      // Group by conversation partner, so one email asks about all of them.
      const groups = new Map<string, { email: EmailMemoryEntry; items: Waiting[] }>();
      due.forEach((w, i) => {
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
        await ensureChatBotUser();
        await sendChatMessage(
          student.id,
          CHAT_BOT_USER_ID,
          `⏳ No offer yet after ${Math.max(...g.items.map((w) => w.days))} days — an email asking ${org} for an update is waiting in Gmail Drafts: ${list.join(' · ')}`,
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
