// When a reminder's WhatsApp messages go out.
//
// A reminder fires FOUR times: once the moment it is created, then a day, an hour,
// and five minutes before the event. Each stage sends at most once, ever.
//
// Two rules keep this from misbehaving:
//
//   1. A stage whose moment has ALREADY PASSED when the reminder is created is marked
//      'skipped', never sent. Creating a reminder for 30 minutes from now must not
//      immediately fire the "a day before" and "an hour before" messages at once.
//
//   2. A stage only sends inside a window that ends shortly after the event. If the
//      scheduler is down for a week, nobody receives "your interview is in 5 minutes"
//      for an interview that happened last Tuesday — those stages are marked 'skipped'.
//
// This file is deliberately pure: no Firestore, no network, so the timing can be
// checked in isolation.

import { formatKuwaitTime } from './timestamp-utils';

export type ReminderStage = 'created' | 'day' | 'hour' | 'final';

/** Recorded per stage: an ISO timestamp once sent, or 'skipped' if it was never applicable. */
export type StageLog = Partial<Record<ReminderStage, string>>;

export const SKIPPED = 'skipped';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long after the event a stage may still be delivered before it is dropped. */
export const LATE_GRACE_MS = 30 * MINUTE;

type StageDef = {
  key: ReminderStage;
  /** How far before the event this stage fires. `null` means "at creation". */
  leadMs: number | null;
  /** Wording for the {{4}} template variable, which reads "this event is ___". */
  phrase: (dueAt: string) => string;
};

export const REMINDER_STAGES: StageDef[] = [
  {
    key: 'created',
    leadMs: null,
    phrase: (d) => `on ${formatKuwaitTime(d)}`,
  },
  {
    key: 'day',
    leadMs: DAY,
    phrase: (d) => `tomorrow — ${formatKuwaitTime(d)}`,
  },
  {
    key: 'hour',
    leadMs: HOUR,
    phrase: (d) => `in 1 hour — ${formatKuwaitTime(d)}`,
  },
  {
    key: 'final',
    leadMs: 5 * MINUTE,
    phrase: (d) => `in 5 minutes — ${formatKuwaitTime(d)}`,
  },
];

const STAGE_BY_KEY = new Map(REMINDER_STAGES.map((s) => [s.key, s]));

export function stagePhrase(stage: ReminderStage, dueAt: string): string {
  return (STAGE_BY_KEY.get(stage) ?? REMINDER_STAGES[0]).phrase(dueAt);
}

/** The moment a stage becomes eligible. `created` is eligible immediately. */
function stageTime(stage: StageDef, dueAtMs: number, createdAtMs: number): number {
  return stage.leadMs === null ? createdAtMs : dueAtMs - stage.leadMs;
}

/**
 * The stage log to store when a reminder is created, or when its date is changed.
 *
 * Every stage already in the past is written as 'skipped' so it can never fire later.
 * `created` is left out — the caller sends it immediately and records the result.
 */
export function initialStageLog(dueAt: string, now: Date = new Date()): StageLog {
  const dueAtMs = Date.parse(dueAt);
  const nowMs = now.getTime();
  const log: StageLog = {};

  for (const stage of REMINDER_STAGES) {
    if (stage.key === 'created') continue;
    if (stageTime(stage, dueAtMs, nowMs) <= nowMs) log[stage.key] = SKIPPED;
  }
  return log;
}

/**
 * Which stages should be sent right now.
 *
 * Returns both the stages to SEND and the stages to mark 'skipped' — a stage whose
 * window has closed is recorded so it is never reconsidered.
 */
export function stagesDueNow(
  reminder: { dueAt: string; createdAt?: string; stages?: StageLog },
  now: Date = new Date(),
): { send: ReminderStage[]; skip: ReminderStage[] } {
  const dueAtMs = Date.parse(reminder.dueAt);
  const createdAtMs = reminder.createdAt ? Date.parse(reminder.createdAt) : dueAtMs;
  const nowMs = now.getTime();
  const log = reminder.stages ?? {};

  const send: ReminderStage[] = [];
  const skip: ReminderStage[] = [];

  for (const stage of REMINDER_STAGES) {
    if (log[stage.key]) continue; // already sent or already skipped

    const eligibleAt = stageTime(stage, dueAtMs, createdAtMs);
    if (nowMs < eligibleAt) continue; // not yet

    // Eligible — but has the moment gone stale? The window closes shortly after the
    // event itself, so a backlog can never fire all at once months later.
    if (nowMs > dueAtMs + LATE_GRACE_MS) {
      skip.push(stage.key);
      continue;
    }
    send.push(stage.key);
  }

  return { send, skip };
}

/**
 * A reminder with no stage log at all predates this feature. Treat its old
 * `whatsAppSentAt` field as the `created` stage so it is not re-announced.
 */
export function migrateLegacyStages(reminder: {
  stages?: StageLog;
  whatsAppSentAt?: string;
}): StageLog | null {
  if (reminder.stages) return null;
  return reminder.whatsAppSentAt ? { created: reminder.whatsAppSentAt } : {};
}
