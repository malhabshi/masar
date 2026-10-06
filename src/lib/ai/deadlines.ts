// Dates that matter, found in the documents, and reminders before they pass.
//
// From what the document reader has understood (documents.ts cards) and the change-agent
// log, for every open student:
//   offer deadline      — accept / pay the deposit by (skipped when that application is
//                          rejected, or the student chose another university)
//   CAS expiry           — use the CAS for the visa by (until the visa is granted)
//   passport             — expires within 6 months of the course start (or of today)
//   IELTS                — a result is valid two years; flagged if it runs out before the
//                          course starts and the visa is not done
//   change agent         — the date the student must choose an agent by
// Dated items are announced in the student's internal chat to the assigned employee 7
// days and 1 day before; passport and IELTS warnings once. Each alert is sent once
// (ai_deadline_alerts). A finalized student gets none in the chat. The full list shows on
// the AI Activity page.
//
// A passport warning also opens a Missing Item "Renewed passport", once per passport. When a
// newer passport is uploaded and read, auto-fill closes it (autofill.ts). If staff remove it,
// it stays removed.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { sendChatMessage } from '@/lib/actions';
import { logAiAction } from './action-log';
import { CHAT_BOT_USER_ID, ensureChatBotUser, quietWhenFinalized } from './chat-bot';
import type { DocCard } from './documents';
import type { Application } from '@/lib/types';

const ALERTS = 'ai_deadline_alerts';
const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export type DeadlineKind = 'offer' | 'cas' | 'passport' | 'ielts' | 'change_agent';

export type Deadline = {
  key: string;
  studentId: string;
  studentName: string;
  employeeId: string | null;
  kind: DeadlineKind;
  /** What it is, for staff. */
  label: string;
  date: string;
  daysLeft: number;
  /** Warnings (passport, IELTS) are a condition, not a countdown: announced once. */
  warning: boolean;
};

type StoredDoc = { id?: string; name?: string; uploadedAt?: string; ai?: DocCard };

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY);
const addYears = (iso: string, y: number) => `${Number(iso.slice(0, 4)) + y}${iso.slice(4)}`;
const words = (s: string) =>
  s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !['university', 'college', 'international', 'study', 'centre', 'kaplan', 'pathways'].includes(w));
const sameUniversity = (a: string, b: string) => {
  const wa = words(a);
  return wa.length > 0 && wa.some((w) => b.toLowerCase().includes(w));
};

/** The deadlines in one student's record. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deadlinesFor(studentId: string, s: Record<string, any>, now: string = today()): Deadline[] {
  const out: Deadline[] = [];
  const d = { id: studentId };
  ((): void => {
    const base = { studentId: d.id, studentName: s.name as string, employeeId: (s.employeeId as string) ?? null };
    const docs = ((s.documents ?? []) as StoredDoc[]).filter((x) => x.ai?.status === 'read' && x.ai.matchesStudent !== false);
    const apps = (s.applications ?? []) as Application[];
    const final: string | undefined = s.finalChoiceUniversity;
    const visaDone = s.profileCompletionStatus?.visaGranted === true;

    // When the course starts: the final choice's offer or CAS, else the earliest one on file.
    const starts = docs
      .filter((x) => (x.ai!.type === 'offer' || x.ai!.type === 'cas') && ISO.test(x.ai!.facts.startDate ?? ''))
      .map((x) => ({ uni: x.ai!.facts.university ?? x.name ?? '', start: x.ai!.facts.startDate! }));
    const start =
      (final && starts.find((x) => sameUniversity(final, x.uni))?.start) ||
      starts.filter((x) => x.start >= now).sort((a, b) => a.start.localeCompare(b.start))[0]?.start ||
      null;

    const newestPassportExpiry = docs
      .filter((x) => x.ai!.type === 'passport' && ISO.test(x.ai!.facts.expiryDate ?? ''))
      .map((x) => x.ai!.facts.expiryDate!)
      .sort()
      .pop();
    for (const doc of docs) {
      const c = doc.ai!;
      const f = c.facts ?? {};
      if (c.type === 'offer' && ISO.test(f.deadline ?? '') && f.deadline! >= now) {
        const uni = f.university ?? doc.name ?? 'the university';
        const app = apps.find((a) => sameUniversity(uni, a.university));
        if (app?.status === 'Rejected') continue;
        if (final && !sameUniversity(final, uni)) continue;
        out.push({
          ...base,
          key: `${d.id}__offer__${doc.id}__${f.deadline}`,
          kind: 'offer',
          label: `${uni}: offer deadline${f.deposit ? ` (deposit ${f.deposit})` : ''}`,
          date: f.deadline!,
          daysLeft: daysBetween(now, f.deadline!),
          warning: false,
        });
      }
      // A deadline printed on a CAS is usually the latest arrival / enrolment date — the
      // one date after which the place can be lost.
      const casForOtherSchool = c.type === 'cas' && !!final && !!f.university && !sameUniversity(final, f.university);
      if (c.type === 'cas' && !casForOtherSchool && ISO.test(f.deadline ?? '') && f.deadline! >= now) {
        const uni = f.university ?? 'CAS';
        out.push({
          ...base,
          key: `${d.id}__casdeadline__${doc.id}__${f.deadline}`,
          kind: 'cas',
          label: `${uni}: deadline on the CAS (usually the latest arrival or enrolment date)`,
          date: f.deadline!,
          daysLeft: daysBetween(now, f.deadline!),
          warning: false,
        });
      }
      if (c.type === 'cas' && !casForOtherSchool && !visaDone && ISO.test(f.expiryDate ?? '') && f.expiryDate! >= now) {
        out.push({
          ...base,
          key: `${d.id}__cas__${doc.id}__${f.expiryDate}`,
          kind: 'cas',
          label: `${f.university ?? 'CAS'}: CAS must be used for the visa by this date`,
          date: f.expiryDate!,
          daysLeft: daysBetween(now, f.expiryDate!),
          warning: false,
        });
      }
      // Only the passport that lasts longest counts — an old one left on file after a
      // renewal is not a problem.
      if (c.type === 'passport' && ISO.test(f.expiryDate ?? '') && f.expiryDate === newestPassportExpiry) {
        const against = start ?? now;
        const margin = daysBetween(against, f.expiryDate!);
        if (margin < 183) {
          out.push({
            ...base,
            key: `${d.id}__passport__${f.expiryDate}`,
            kind: 'passport',
            label:
              f.expiryDate! < now
                ? `The passport on file expired on ${f.expiryDate} — upload the renewed passport (needed for the visa)`
                : start
                  ? `Passport expires ${f.expiryDate}, under 6 months after the course starts (${start}) — renew before the visa`
                  : `Passport expires ${f.expiryDate}, under 6 months away — renew before the visa`,
            date: f.expiryDate!,
            daysLeft: daysBetween(now, f.expiryDate!),
            warning: true,
          });
        }
      }
    }

    // IELTS: the newest result only, valid two years from the test.
    const ielts = docs
      .filter((x) => x.ai!.type === 'ielts' && ISO.test(x.ai!.facts.testDate ?? ''))
      .sort((a, b) => b.ai!.facts.testDate!.localeCompare(a.ai!.facts.testDate!))[0];
    if (ielts && !visaDone && start) {
      const validUntil = addYears(ielts.ai!.facts.testDate!, 2);
      if (validUntil < start) {
        out.push({
          ...base,
          key: `${d.id}__ielts__${ielts.ai!.facts.testDate}`,
          kind: 'ielts',
          label: `IELTS from ${ielts.ai!.facts.testDate} is valid until ${validUntil}, before the course starts (${start}) — a new test may be needed for the visa`,
          date: validUntil,
          daysLeft: daysBetween(now, validUntil),
          warning: true,
        });
      }
    }

    // Change agent: "Decision deadline: YYYY-MM-DD" in an open log entry.
    if (s.changeAgentRequired) {
      for (const e of (s.changeAgentLog ?? []) as Array<{ university: string; note?: string; resolvedAt?: string }>) {
        const m = String(e.note ?? '').match(/Decision deadline: (\d{4}-\d{2}-\d{2})/);
        if (!m || e.resolvedAt || m[1] < now) continue;
        out.push({
          ...base,
          key: `${d.id}__ca__${e.university}__${m[1]}`,
          kind: 'change_agent',
          label: `${e.university}: the student must choose an agent by this date (change of agent)`,
          date: m[1],
          daysLeft: daysBetween(now, m[1]),
          warning: false,
        });
      }
    }
  })();
  return out;
}

/** Every relevant date for every open student. */
export async function collectDeadlines(): Promise<Deadline[]> {
  const now = today();
  const out: Deadline[] = [];
  const snap = await db()
    .collection('students')
    .select('name', 'employeeId', 'isClosed', 'documents', 'applications', 'finalChoiceUniversity', 'profileCompletionStatus', 'changeAgentLog', 'changeAgentRequired')
    .get();

  for (const d of snap.docs) {
    const s = d.data();
    if (s.isClosed === true) continue;
    out.push(...deadlinesFor(d.id, s, now));
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Send the reminders that are due today. Each one only once. */
export async function runDeadlineAlerts() {
  const result = { checked: 0, sent: 0 };
  const deadlines = await collectDeadlines();
  result.checked = deadlines.length;
  const users = (await db().collection('users').get()).docs.map((u) => ({ id: u.id, ...(u.data() as { civilId?: string }) }));

  for (const d of deadlines) {
    if (d.kind === 'passport') await openRenewalItem(d).catch((e) => console.error('[deadlines] renewal item:', e));
    const stage = d.warning ? 'once' : d.daysLeft <= 1 ? '1' : d.daysLeft <= 7 ? '7' : null;
    if (!stage) continue;
    const ref = db().collection(ALERTS).doc(`${d.key}__${stage}`.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 400));
    if ((await ref.get()).exists) continue;
    // Not marked sent: if the final choice is cleared, the reminder still comes.
    if (await quietWhenFinalized(d.studentId)) continue;

    const employee = users.find((u) => d.employeeId && u.civilId === d.employeeId);
    const when = d.daysLeft === 0 ? 'today' : d.daysLeft === 1 ? 'tomorrow' : `in ${d.daysLeft} days (${d.date})`;
    const content = d.warning ? `⚠️ ${d.label}.` : `⏰ ${d.label} — ${when}.`;
    await ensureChatBotUser();
    const sent = await sendChatMessage(d.studentId, CHAT_BOT_USER_ID, content, employee ? [employee.id] : ['admins']);
    if (sent.success) {
      await ref.set({ ...d, stage, sentAt: new Date().toISOString() });
      result.sent++;
    }
  }
  return result;
}

/** The Missing Item that goes with a passport warning — once per passport, recorded in ai_deadline_alerts. */
export async function openRenewalItem(d: Deadline) {
  const mark = db().collection(ALERTS).doc(`${d.key}__item`.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 400));
  if ((await mark.get()).exists) return;
  const now = new Date().toISOString();
  const item = {
    id: `mi-ai-passport-${d.date}`,
    text: `Renewed passport — the one on file ${d.date < today() ? 'expired' : 'expires'} on ${d.date}`,
    department: 'Documents',
    addedBy: 'ai',
    createdAt: now,
    /** Closed by auto-fill when a passport expiring after this date is read. */
    passportExpiry: d.date,
  };
  const ref = db().collection('students').doc(d.studentId);
  const s = (await ref.get()).data();
  const already = ((s?.missingItems ?? []) as Array<string | { id?: string }>).some((m) => typeof m !== 'string' && m.id === item.id);
  if (!already) {
    await ref.update({ missingItems: FieldValue.arrayUnion(item), newMissingItemsForEmployee: FieldValue.increment(1), lastActivityAt: now });
    await logAiAction({
      source: 'document',
      summary: `Missing Item added: ${item.text}`,
      reason: d.label,
      studentId: d.studentId,
      studentName: d.studentName,
      undo: { type: 'remove_missing_items', ids: [item.id] },
    });
  }
  await mark.set({ ...d, item: item.id, addedAt: now });
}

/** Once a day, from 09:00 Kuwait. */
export async function deadlineAlertsIfDue() {
  const k = new Date(Date.now() + 3 * 3_600_000);
  if (k.getUTCHours() < 9) return { skipped: 'before 09:00 Kuwait' };
  const ref = db().collection('app_settings').doc('ai_deadline_state');
  const day = k.toISOString().slice(0, 10);
  if ((await ref.get()).data()?.lastRun === day) return { skipped: 'already ran today' };
  await ref.set({ lastRun: day }, { merge: true });
  return runDeadlineAlerts();
}
