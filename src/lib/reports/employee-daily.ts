// The daily report on each employee's work, and how they did.
//
// Everything is counted from what the system already records against a person and a
// time — login sessions, students they created, requests they raised or handled, chat
// messages, documents, pipeline changes, notes — for one Kuwait calendar day, plus a
// snapshot of the students they look after (late applications, students gone quiet,
// messages still waiting on them). The AI then reads the whole team's numbers together
// and writes a short, fair assessment of each person.
//
// A day's report is kept in employee_daily_reports/{date}, so opening it again is
// instant; "Refresh" rebuilds it.

import Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_DOC_MODEL, isAiConfigured } from '@/lib/ai/config';
import { getLateRules } from '@/lib/late-applications';
import type { Application } from '@/lib/types';

export const DAILY_REPORT_COLLECTION = 'employee_daily_reports';
const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const DAY = 86_400_000;
const STAGNANT_DAYS = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export type EmployeeDay = {
  userId: string;
  name: string;
  role: string;
  department: string | null;
  /** Logged-in time (sessions merged). Only tracked for employees; null for department users. */
  hours: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  /** First and last thing they actually did that day — a truer picture than session time. */
  firstAction: string | null;
  lastAction: string | null;
  actions: number;
  studentsCreated: number;
  requestsCreated: number;
  requestsByType: Record<string, number>;
  requestsHandled: number;
  taskReplies: number;
  chatMessages: number;
  messagesAnsweredToday: number;
  avgReplyHours: number | null;
  messagesWaiting: number;
  documentsUploaded: number;
  pipelineChanges: number;
  notesWritten: number;
  inactivityReports: number;
  portfolio: {
    openStudents: number;
    lateApplications: number;
    stagnantStudents: number;
    openMissingItems: number;
  } | null;
  rating?: 'excellent' | 'good' | 'needs_attention' | 'inactive';
  assessment?: string;
  suggestion?: string;
};

export type DailyReport = {
  date: string;
  generatedAt: string;
  employees: EmployeeDay[];
  teamSummary?: string;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

/** Start and end (ISO, UTC) of a Kuwait calendar day "YYYY-MM-DD". */
function dayBounds(date: string): { start: string; end: string } {
  const start = new Date(new Date(`${date}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS);
  return { start: start.toISOString(), end: new Date(start.getTime() + DAY).toISOString() };
}

export function kuwaitToday(): string {
  return new Date(Date.now() + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
}

const inDay = (iso: unknown, b: { start: string; end: string }) => {
  const s = String(iso ?? '');
  return s >= b.start && s < b.end;
};

function blank(u: Row): EmployeeDay {
  return {
    userId: u.id,
    name: u.name ?? u.id,
    role: u.role,
    department: u.department ?? null,
    hours: u.role === 'employee' ? 0 : null,
    firstSeen: null,
    lastSeen: null,
    firstAction: null,
    lastAction: null,
    actions: 0,
    studentsCreated: 0,
    requestsCreated: 0,
    requestsByType: {},
    requestsHandled: 0,
    taskReplies: 0,
    chatMessages: 0,
    messagesAnsweredToday: 0,
    avgReplyHours: null,
    messagesWaiting: 0,
    documentsUploaded: 0,
    pipelineChanges: 0,
    notesWritten: 0,
    inactivityReports: 0,
    portfolio: null,
  };
}

/** Count one day's work for every employee and department user. */
export async function computeDay(date: string): Promise<EmployeeDay[]> {
  const b = dayBounds(date);
  const now = Date.now();
  const usersSnap = await db().collection('users').get();
  // Real people only: not the AI, and not the holding account closed profiles are moved to.
  const staff = usersSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Row)
    .filter(
      (u) =>
        (u.role === 'employee' || u.role === 'department') &&
        !u.isBot &&
        String(u.civilId ?? '') !== '123456789010' &&
        !/closed students/i.test(String(u.name ?? '')),
    );
  const byId = new Map(staff.map((u) => [u.id, blank(u)]));
  const byName = new Map(staff.map((u) => [String(u.name ?? '').trim().toLowerCase(), u.id]));
  const byCivil = new Map(staff.filter((u) => u.civilId).map((u) => [String(u.civilId), u.id]));
  const who = (id: unknown) => byId.get(String(id ?? ''));
  /** Record that a person did something at this time. */
  const acted = (e: EmployeeDay | undefined, at: unknown) => {
    if (!e || !inDay(at, b)) return;
    const t = String(at);
    e.actions++;
    if (!e.firstAction || t < e.firstAction) e.firstAction = t;
    if (!e.lastAction || t > e.lastAction) e.lastAction = t;
  };

  // ---- Login sessions -------------------------------------------------------------
  // A session ends at its last heartbeat: an auto-close the next morning is not work.
  // Overlapping sessions (two tabs or devices) are merged so time is never counted twice.
  const logs = await db().collection('time_logs').where('clockIn', '>=', b.start).where('clockIn', '<', b.end).get();
  const spans = new Map<string, Array<[number, number]>>();
  for (const d of logs.docs) {
    const l = d.data();
    const e = who(l.employeeId);
    if (!e || e.hours === null) continue;
    const startMs = new Date(l.clockIn).getTime();
    const endIso = l.lastSeen ?? l.clockOut ?? l.clockIn;
    const endMs = Math.min(new Date(endIso).getTime(), new Date(b.end).getTime(), now);
    if (endMs > startMs) spans.set(e.userId, [...(spans.get(e.userId) ?? []), [startMs, endMs]]);
    if (!e.firstSeen || l.clockIn < e.firstSeen) e.firstSeen = l.clockIn;
    if (!e.lastSeen || endIso > e.lastSeen) e.lastSeen = endIso;
  }
  for (const [id, list] of spans) {
    list.sort((a, z) => a[0] - z[0]);
    let total = 0;
    let [cs, ce] = list[0];
    for (const [s0, e0] of list.slice(1)) {
      if (s0 <= ce) ce = Math.max(ce, e0);
      else {
        total += ce - cs;
        [cs, ce] = [s0, e0];
      }
    }
    total += ce - cs;
    byId.get(id)!.hours = total / 3_600_000;
  }

  // ---- Students: created, notes, documents, pipeline, portfolio ---------------------
  const rules = await getLateRules();
  const students = await db()
    .collection('students')
    .select('name', 'createdBy', 'createdAt', 'employeeId', 'adminNotes', 'employeeNotes', 'documents', 'applications', 'missingItems', 'lastActivityAt', 'isClosed')
    .get();
  for (const d of students.docs) {
    const s = d.data();
    const creator = who(s.createdBy);
    if (creator && inDay(s.createdAt, b)) {
      creator.studentsCreated++;
      acted(creator, s.createdAt);
    }

    for (const n of (s.employeeNotes ?? []) as Row[]) {
      const e = who(n.authorId);
      if (e && inDay(n.createdAt, b)) {
        e.notesWritten++;
        acted(e, n.createdAt);
      }
    }
    for (const n of (s.adminNotes ?? []) as Row[]) {
      if (!inDay(n.createdAt, b)) continue;
      const m = String(n.content ?? '').match(/^Pipeline updated to ["'][a-z]+["'] by (.+?)\.?\s*$/i);
      if (m) {
        const id = byName.get(m[1].trim().toLowerCase());
        if (id) {
          byId.get(id)!.pipelineChanges++;
          acted(byId.get(id), n.createdAt);
        }
        continue;
      }
      const e = who(n.authorId);
      if (e && !String(n.content ?? '').startsWith('[')) {
        e.notesWritten++;
        acted(e, n.createdAt);
      }
    }
    for (const doc of (s.documents ?? []) as Row[]) {
      const e = who(doc.authorId);
      if (e && inDay(doc.uploadedAt, b)) {
        e.documentsUploaded++;
        acted(e, doc.uploadedAt);
      }
    }

    // Portfolio snapshot, for the employee the student is assigned to.
    if (s.isClosed === true || !s.employeeId) continue;
    const ownerId = byCivil.get(String(s.employeeId));
    if (!ownerId) continue;
    const owner = byId.get(ownerId)!;
    owner.portfolio ??= { openStudents: 0, lateApplications: 0, stagnantStudents: 0, openMissingItems: 0 };
    owner.portfolio.openStudents++;
    owner.portfolio.openMissingItems += (s.missingItems ?? []).length;
    const last = new Date(s.lastActivityAt ?? s.createdAt ?? 0).getTime();
    if (now - last > STAGNANT_DAYS * DAY) owner.portfolio.stagnantStudents++;
    for (const a of (s.applications ?? []) as Application[]) {
      const limit = (rules.daysByStatus as Record<string, number>)[a.status];
      if (!limit || !a.updatedAt) continue;
      if (now - new Date(a.updatedAt).getTime() > limit * DAY) owner.portfolio.lateApplications++;
    }
  }

  // ---- Requests: raised, replied to, completed / denied -----------------------------
  const tasks = await db().collection('tasks').where('createdAt', '>=', new Date(new Date(b.start).getTime() - 30 * DAY).toISOString()).get();
  for (const d of tasks.docs) {
    const t = d.data();
    if (t.category === 'request') {
      const e = who(t.authorId);
      if (e && inDay(t.createdAt, b)) {
        e.requestsCreated++;
        const type = String(t.taskType ?? 'Other').trim();
        e.requestsByType[type] = (e.requestsByType[type] ?? 0) + 1;
        acted(e, t.createdAt);
      }
      for (const r of (t.replies ?? []) as Row[]) {
        const re = who(r.authorId);
        if (re && inDay(r.createdAt, b)) {
          re.taskReplies++;
          acted(re, r.createdAt);
        }
      }
    } else if (t.category === 'system' && inDay(t.createdAt, b)) {
      const m = String(t.content ?? '').match(/status updated to '(completed|denied)' by (.+?)\.?$/m);
      const name = (t.updatedByName as string | undefined) ?? m?.[2];
      if ((t.newStatus === 'completed' || t.newStatus === 'denied' || m) && name) {
        const id = byName.get(name.trim().toLowerCase());
        if (id) {
          byId.get(id)!.requestsHandled++;
          acted(byId.get(id), t.createdAt);
        }
      }
    }
  }

  // ---- Internal chat: sent, answered, waiting ----------------------------------------
  const windowStart = new Date(new Date(b.start).getTime() - 7 * DAY).toISOString();
  const active = await db().collection('students').where('lastChatMessageTimestamp', '>=', windowStart).select().get();
  const replyHours = new Map<string, number[]>();
  for (let i = 0; i < active.docs.length; i += 25) {
    const batch = active.docs.slice(i, i + 25);
    const threads = await Promise.all(
      batch.map((s) =>
        db().collection('chats').doc(s.id).collection('messages').where('timestamp', '>=', windowStart).get(),
      ),
    );
    for (const snap of threads) {
      const msgs = snap.docs.map((m) => m.data()).sort((a, z) => String(a.timestamp).localeCompare(String(z.timestamp)));
      msgs.forEach((m, idx) => {
        const author = who(m.authorId);
        if (author && inDay(m.timestamp, b)) {
          author.chatMessages++;
          acted(author, m.timestamp);
          if (/^@Admins: Inactivity Report/.test(String(m.content ?? ''))) author.inactivityReports++;
        }
        // Messages addressed by name to a staff member: when (if) did they answer?
        if (String(m.timestamp) >= b.end) return;
        for (const target of (m.targetUserIds ?? []) as string[]) {
          const e = byId.get(target);
          if (!e || target === m.authorId) continue;
          const reply = msgs.slice(idx + 1).find((x) => x.authorId === target);
          if (reply && String(reply.timestamp) < b.end) {
            if (inDay(reply.timestamp, b)) {
              e.messagesAnsweredToday++;
              const h = (new Date(reply.timestamp).getTime() - new Date(m.timestamp).getTime()) / 3_600_000;
              replyHours.set(target, [...(replyHours.get(target) ?? []), h]);
            }
          } else {
            e.messagesWaiting++;
          }
        }
      });
    }
  }
  for (const [id, hs] of replyHours) {
    byId.get(id)!.avgReplyHours = Math.round((hs.reduce((a, z) => a + z, 0) / hs.length) * 10) / 10;
  }

  return [...byId.values()].map((e) => ({ ...e, hours: e.hours === null ? null : Math.round(e.hours * 10) / 10 }));
}

// --------------------------------------------------------------------------
// The AI's assessment
// --------------------------------------------------------------------------

const REVIEW_SYSTEM = `You review one day's work for the staff of a Kuwaiti study-abroad agency, from the numbers the system recorded, and write what a fair manager would say. Call record_review once.

Staff: "employee" counsellors each look after their own students (portfolio); "department" users process applications for a country (they handle requests and reply in chat, they have no portfolio).

For each person:
- rating: "excellent", "good", "needs_attention" or "inactive" (no login and no activity at all).
- assessment: two short sentences in plain English — what they got done and how it compares with the rest of the team that day. Mention the strongest number and the weakest. Never invent work that is not in the numbers.
- suggestion: one concrete thing for tomorrow, from their own numbers (e.g. "Reply to the 4 messages waiting on you", "3 students have had no activity for 20+ days").
Be fair:
- hours is logged-in time with the site open, which can include idle time with a tab left open; it is null for department users, whose logins are not tracked — never judge them on it. firstAction/lastAction and actions (how many recorded things they did) show the real working day better.
- A busy day with few logged hours is still a busy day. Waiting messages and late applications matter more than raw counts.
- Times are Kuwait local time (HH:MM).
teamSummary: two sentences on the whole team's day.`;

const REVIEW_TOOL: Anthropic.Tool = {
  name: 'record_review',
  description: "Record the day's review.",
  input_schema: {
    type: 'object',
    properties: {
      people: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            rating: { type: 'string', enum: ['excellent', 'good', 'needs_attention', 'inactive'] },
            assessment: { type: 'string' },
            suggestion: { type: 'string' },
          },
          required: ['userId', 'rating', 'assessment', 'suggestion'],
        },
      },
      teamSummary: { type: 'string' },
    },
    required: ['people', 'teamSummary'],
  },
};

/** "14:08" in Kuwait time, for the AI to quote. */
function kuwaitClock(iso: string | null): string | null {
  return iso ? new Date(new Date(iso).getTime() + KUWAIT_OFFSET_MS).toISOString().slice(11, 16) : null;
}

async function review(date: string, employees: EmployeeDay[]) {
  const res = await getAnthropicClient('daily-report').messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 6000,
    system: REVIEW_SYSTEM,
    tools: [REVIEW_TOOL],
    messages: [
      {
        role: 'user',
        content: `Day: ${date} (Kuwait). The numbers for each person:\n${JSON.stringify(
          employees.map(({ assessment: _a, suggestion: _s, rating: _r, ...rest }) => ({
            ...rest,
            firstAction: kuwaitClock(rest.firstAction),
            lastAction: kuwaitClock(rest.lastAction),
            firstSeen: kuwaitClock(rest.firstSeen),
            lastSeen: kuwaitClock(rest.lastSeen),
          })),
        )}`,
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  return (use?.input ?? {}) as { people?: Array<{ userId: string; rating: EmployeeDay['rating']; assessment: string; suggestion: string }>; teamSummary?: string };
}

/** Build (or rebuild) a day's report and keep it. */
export async function buildDailyReport(date: string): Promise<DailyReport> {
  const employees = await computeDay(date);
  let teamSummary: string | undefined;
  if (isAiConfigured()) {
    try {
      const r = await review(date, employees);
      for (const p of r.people ?? []) {
        const e = employees.find((x) => x.userId === p.userId);
        if (e) Object.assign(e, { rating: p.rating, assessment: p.assessment, suggestion: p.suggestion });
      }
      teamSummary = r.teamSummary;
    } catch (e) {
      console.error('[daily-report] review failed:', e);
    }
  }
  const order = { excellent: 0, good: 1, needs_attention: 2, inactive: 3 } as Record<string, number>;
  employees.sort((a, z) => (order[a.rating ?? 'good'] ?? 1) - (order[z.rating ?? 'good'] ?? 1) || z.actions - a.actions);
  const report: DailyReport = { date, generatedAt: new Date().toISOString(), employees, ...(teamSummary ? { teamSummary } : {}) };
  await db().collection(DAILY_REPORT_COLLECTION).doc(date).set(JSON.parse(JSON.stringify(report)));
  return report;
}

export async function getDailyReport(date: string): Promise<DailyReport | null> {
  const snap = await db().collection(DAILY_REPORT_COLLECTION).doc(date).get();
  return snap.exists ? (snap.data() as DailyReport) : null;
}

/** Once a day, late evening Kuwait time, the day's report is built by itself. */
export async function buildTodayIfDue(): Promise<{ built?: string; skipped?: string }> {
  const k = new Date(Date.now() + KUWAIT_OFFSET_MS);
  if (k.getUTCHours() < 22) return { skipped: 'before 22:00 Kuwait' };
  const date = k.toISOString().slice(0, 10);
  const existing = await getDailyReport(date);
  if (existing && existing.generatedAt >= new Date(new Date(`${date}T22:00:00Z`).getTime() - KUWAIT_OFFSET_MS).toISOString()) {
    return { skipped: 'already built tonight' };
  }
  await buildDailyReport(date);
  return { built: date };
}
