// When the inbox is checked by itself: Monday to Friday at 10:00, 13:00 and 15:00, Kuwait
// time — as the admin set it. Pressing "Check inbox now" works any time as well.
//
// The five-minute cron is the clock. During the first 55 minutes after each check time
// it starts an inbox run of up to 10 emails, round after round, until a run finds nothing
// new; then that check is marked done for the day.

import { adminDb } from '@/lib/firebase/admin';

export const CHECK_HOURS = [10, 13, 15];
/** Monday … Friday, as returned by getUTCDay() on Kuwait time. */
const WORKDAYS = [1, 2, 3, 4, 5];
const WINDOW_MINUTES = 55;
const STATE = { collection: 'app_settings', doc: 'email_intake_schedule' };

export const SCHEDULE_LABEL = 'Monday–Friday at 10:00, 13:00 and 15:00 (Kuwait time)';

/** Kuwait is UTC+3 all year — no daylight saving. */
function kuwaitNow(): Date {
  return new Date(Date.now() + 3 * 3_600_000);
}

/** The check currently due, e.g. "2026-10-05@13", or null outside the check windows. */
export function currentSlot(): string | null {
  const k = kuwaitNow();
  if (!WORKDAYS.includes(k.getUTCDay())) return null;
  const hour = CHECK_HOURS.find((h) => k.getUTCHours() === h && k.getUTCMinutes() < WINDOW_MINUTES);
  if (hour === undefined) return null;
  return `${k.toISOString().slice(0, 10)}@${hour}`;
}

export async function isSlotDone(slot: string): Promise<boolean> {
  if (!adminDb) return true;
  const d = (await adminDb.collection(STATE.collection).doc(STATE.doc).get()).data();
  return d?.doneSlot === slot;
}

export async function markSlotDone(slot: string, processedTotal: number) {
  if (!adminDb) return;
  await adminDb
    .collection(STATE.collection)
    .doc(STATE.doc)
    .set({ doneSlot: slot, doneAt: new Date().toISOString(), lastProcessed: processedTotal }, { merge: true });
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
