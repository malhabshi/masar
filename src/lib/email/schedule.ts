// When the inbox is checked by itself: Monday to Friday at 10:00, 13:00 and 15:00, Kuwait
// time — as the admin set it. Pressing "Check inbox now" works any time as well.
//
// The five-minute cron is the clock. During the first 55 minutes after each check time
// it starts an inbox run of up to 10 emails, round after round, until a run finds nothing
// new; then that check is marked done for the day.
//
// A check whose run never finished is not dropped when its 55 minutes are up: it stays due,
// and is started again every five minutes, until a run of it finishes — and rounds go on
// while each takes a full ROUND_SIZE, so the backlog is cleared — or the next check time
// comes (after 15:00, until midnight). On 2026-10-09 a caught-up check stopped after ten
// emails and left INTO's "late fees, response required" for Monday. On 2026-10-06 the 13:00 and 15:00 checks never ran and
// Merit's email waited for a person to notice. Every start and every finished run is kept
// (lastStart, lastRun) and shown on the Email Intake page.

import { adminDb } from '@/lib/firebase/admin';

export const CHECK_HOURS = [10, 13, 15];
/** Monday … Friday, as returned by getUTCDay() on Kuwait time. */
const WORKDAYS = [1, 2, 3, 4, 5];
const WINDOW_MINUTES = 55;
/** Emails per scheduled round. A round that takes this many may have left more behind. */
export const ROUND_SIZE = 10;
const STATE = { collection: 'app_settings', doc: 'email_intake_schedule' };

export const SCHEDULE_LABEL = 'Monday–Friday at 10:00, 13:00 and 15:00 (Kuwait time)';

export type ScheduleState = {
  doneSlot?: string;
  doneAt?: string;
  lastProcessed?: number;
  /** The cron asked for a run. error: the request failed at once. */
  lastStart?: { slot: string; at: string; error: string | null };
  /** A scheduled run finished. error: it stopped with one. */
  lastRun?: { slot: string; at: string; processed: number; filed: number; queued: number; failed: number; error: string | null };
};

/** Kuwait is UTC+3 all year — no daylight saving. */
function kuwaitNow(now = Date.now()): Date {
  return new Date(now + 3 * 3_600_000);
}

/** The latest check time already passed today, e.g. "2026-10-05@13"; null before 10:00 and at weekends. */
function latestSlot(now: number): { slot: string; inWindow: boolean } | null {
  const k = kuwaitNow(now);
  if (!WORKDAYS.includes(k.getUTCDay())) return null;
  const hour = [...CHECK_HOURS].reverse().find((h) => k.getUTCHours() >= h);
  if (hour === undefined) return null;
  return {
    slot: `${k.toISOString().slice(0, 10)}@${hour}`,
    inWindow: k.getUTCHours() === hour && k.getUTCMinutes() < WINDOW_MINUTES,
  };
}

export async function getScheduleState(): Promise<ScheduleState> {
  if (!adminDb) return {};
  return ((await adminDb.collection(STATE.collection).doc(STATE.doc).get()).data() ?? {}) as ScheduleState;
}

/**
 * The check to run now, or null. Inside its 55 minutes a check runs round after round until
 * done; after them, only while no run of it has finished without an error, or the last one
 * was full.
 */
export function dueSlotFrom(state: ScheduleState, now = Date.now()): string | null {
  const latest = latestSlot(now);
  if (!latest || state.doneSlot === latest.slot) return null;
  const run = state.lastRun;
  if (latest.inWindow || run?.slot !== latest.slot || run.error || run.processed >= ROUND_SIZE) return latest.slot;
  return null;
}

export async function dueSlot(): Promise<string | null> {
  if (!adminDb || !latestSlot(Date.now())) return null;
  return dueSlotFrom(await getScheduleState());
}

export async function markSlotDone(slot: string, processedTotal: number) {
  if (!adminDb) return;
  await adminDb
    .collection(STATE.collection)
    .doc(STATE.doc)
    .set({ doneSlot: slot, doneAt: new Date().toISOString(), lastProcessed: processedTotal }, { merge: true });
}

export async function recordStart(slot: string, error: string | null) {
  if (!adminDb) return;
  const lastStart: ScheduleState['lastStart'] = { slot, at: new Date().toISOString(), error };
  await adminDb.collection(STATE.collection).doc(STATE.doc).set({ lastStart }, { merge: true });
}

export async function recordRun(
  slot: string,
  result: { processed: number; filed: number; queued: number; failed: number } | null,
  error: string | null = null,
) {
  if (!adminDb) return;
  const lastRun: ScheduleState['lastRun'] = {
    slot,
    at: new Date().toISOString(),
    processed: result?.processed ?? 0,
    filed: result?.filed ?? 0,
    queued: result?.queued ?? 0,
    failed: result?.failed ?? 0,
    error,
  };
  await adminDb.collection(STATE.collection).doc(STATE.doc).set({ lastRun }, { merge: true });
}

/** For the page: when the next automatic check is. */
export function nextCheckLabel(): string {
  const k = kuwaitNow();
  for (let add = 0; add < 8; add++) {
    const day = new Date(k.getTime() + add * 86_400_000);
    if (!WORKDAYS.includes(day.getUTCDay())) continue;
    for (const h of CHECK_HOURS) {
      if (add === 0 && (k.getUTCHours() > h || (k.getUTCHours() === h && k.getUTCMinutes() >= WINDOW_MINUTES))) continue;
      const name = day.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
      return `${add === 0 ? 'today' : add === 1 ? 'tomorrow' : name} at ${String(h).padStart(2, '0')}:00`;
    }
  }
  return 'next working day';
}
