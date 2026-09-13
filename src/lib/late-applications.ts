// Per-application lateness.
//
// The app already has a STUDENT-level "stagnant" concept (no activity on the student
// record for ~20 days). This module is different and finer-grained: it asks whether an
// individual application has been sitting in a non-final status for too long.
//
// There is no deadline field on Application, so lateness is derived from how long the
// application has held its current status — `updatedAt` is written every time the status
// changes, so "now - updatedAt" is the time in the current status.
//
// Thresholds are configurable at runtime (Firestore: app_settings/late_application_rules)
// and fall back to the defaults below, so the rule can be tuned without a deploy.

import { adminDb } from '@/lib/firebase/admin';
import type { Application, ApplicationStatus, Country, Student } from '@/lib/types';

/** Statuses that are final — an application in one of these can never be "late". */
export const TERMINAL_STATUSES: ApplicationStatus[] = ['Accepted', 'Rejected'];

/** Statuses that are still in flight and therefore can go late. */
export const TRACKED_STATUSES = ['Pending', 'Submitted', 'Missing Items'] as const;
export type TrackedStatus = (typeof TRACKED_STATUSES)[number];

export type LateRules = {
  /** Days an application may sit in each status before it counts as late. */
  daysByStatus: Record<TrackedStatus, number>;
};

/**
 * Starting thresholds, chosen against the real production distribution (measured
 * 2026-09-14 over 1,400 open students / 592 in-flight applications):
 *
 *   Missing Items  n=56   median 155d in status, minimum 21d
 *   Pending        n=88   median  36d in status
 *   Submitted      n=448  median  71d, p75 132d
 *
 * These are deliberately NOT tuned to make the alert list look small — an aggressive
 * 7/14/30 set flags 85% of everything in flight, which is noise, but the backlog it
 * reflects is genuine. The values below read as defensible internal SLAs:
 *
 *  - Missing Items (14d): the student owes us documents; two weeks is generous. Note
 *    the shortest-standing item is already 21 days old, so this threshold flags all 56
 *    regardless — a small, genuinely actionable list.
 *  - Pending (30d): a month without us submitting it.
 *  - Submitted (90d): waiting on the university, which is legitimately slow; three
 *    months without a decision is worth chasing.
 *
 * Tune in Firestore (app_settings/late_application_rules) — no deploy needed.
 */
export const DEFAULT_LATE_RULES: LateRules = {
  daysByStatus: {
    'Missing Items': 14,
    Pending: 30,
    Submitted: 90,
  },
};

/**
 * `updatedAt` only starts appearing on applications from 2026-03-23, so "days in
 * status" saturates for anything that last changed before then. Surfaced with every
 * result so the assistant states the limitation instead of implying precision.
 */
export const LATE_DATA_CAVEAT =
  'Application updatedAt history only goes back to 2026-03-23, so anything that last ' +
  'changed status before then reports the same ceiling age rather than its true age. ' +
  'Treat the oldest rows as "at least this old".';

const RULES_DOC_PATH = { collection: 'app_settings', doc: 'late_application_rules' };

/** Read tunable thresholds from Firestore, falling back to DEFAULT_LATE_RULES. */
export async function getLateRules(): Promise<LateRules> {
  if (!adminDb) return DEFAULT_LATE_RULES;
  try {
    const snap = await adminDb.collection(RULES_DOC_PATH.collection).doc(RULES_DOC_PATH.doc).get();
    if (!snap.exists) return DEFAULT_LATE_RULES;
    const stored = (snap.data()?.daysByStatus ?? {}) as Partial<Record<TrackedStatus, unknown>>;
    const merged = { ...DEFAULT_LATE_RULES.daysByStatus };
    for (const status of TRACKED_STATUSES) {
      const value = stored[status];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) merged[status] = value;
    }
    return { daysByStatus: merged };
  } catch {
    return DEFAULT_LATE_RULES;
  }
}

/** Persist new thresholds. Only known statuses with sane values are written. */
export async function saveLateRules(rules: Partial<Record<TrackedStatus, number>>): Promise<LateRules> {
  if (!adminDb) throw new Error('Database not available');
  const current = await getLateRules();
  const next = { ...current.daysByStatus };
  for (const status of TRACKED_STATUSES) {
    const value = rules[status];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) next[status] = Math.round(value);
  }
  await adminDb
    .collection(RULES_DOC_PATH.collection)
    .doc(RULES_DOC_PATH.doc)
    .set({ daysByStatus: next, updatedAt: new Date().toISOString() }, { merge: true });
  return { daysByStatus: next };
}

function daysBetween(fromIso: string | undefined, now: number): number | null {
  if (!fromIso) return null;
  const then = Date.parse(fromIso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now - then) / 86_400_000);
}

export type LateApplication = {
  studentId: string;
  studentName: string;
  employeeId: string | null;
  university: string;
  major: string;
  country: Country;
  status: TrackedStatus;
  /** When the application last changed status (or the student's createdAt as fallback). */
  since: string;
  /** Whether `since` came from the application itself or was inferred from the student. */
  sinceSource: 'application' | 'student';
  daysInStatus: number;
  /** Configured threshold for this status. */
  thresholdDays: number;
  /** How far past the threshold it is. Always >= 1 for a returned row. */
  daysOverdue: number;
};

export type FindLateApplicationsOptions = {
  employeeId?: string;
  country?: Country;
  status?: TrackedStatus;
  /** Max rows returned (most overdue first). */
  limit?: number;
  rules?: LateRules;
};

export type LateApplicationsResult = {
  rules: LateRules;
  /** Standing limitation of the underlying timestamps; report it alongside the numbers. */
  caveat: string;
  /** Students examined (non-closed only). */
  studentsScanned: number;
  /** Total late applications found, before `limit` was applied. */
  totalLate: number;
  /** Count of late applications per status, before `limit`. */
  byStatus: Record<TrackedStatus, number>;
  /** Count of late applications per employee civil ID, before `limit`. */
  byEmployee: Array<{ employeeId: string | null; count: number }>;
  returned: number;
  applications: LateApplication[];
};

/**
 * Scan open students for applications that have overstayed their status threshold.
 *
 * Firestore cannot index inside the `applications` array, so this reads the open-student
 * set and filters in memory. A field mask keeps the payload small, and passing
 * `employeeId` narrows the query to that employee's portfolio — prefer it when possible.
 */
export async function findLateApplications(
  options: FindLateApplicationsOptions = {},
): Promise<LateApplicationsResult> {
  if (!adminDb) throw new Error('Database not available');

  const rules = options.rules ?? (await getLateRules());
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const now = Date.now();

  // One equality filter only, so no composite index is needed. `isClosed` is the
  // baseline filter; if an employee is named we filter on that instead and drop closed
  // students in memory (an employee portfolio is far smaller than the open-student set).
  let query = adminDb
    .collection('students')
    .select('name', 'employeeId', 'applications', 'isClosed', 'createdAt');

  query = options.employeeId
    ? query.where('employeeId', '==', options.employeeId)
    : query.where('isClosed', '==', false);

  const snapshot = await query.get();

  const found: LateApplication[] = [];
  let studentsScanned = 0;

  for (const doc of snapshot.docs) {
    const student = doc.data() as Partial<Student>;
    if (student.isClosed === true) continue;
    studentsScanned++;

    const applications = Array.isArray(student.applications) ? (student.applications as Application[]) : [];
    for (const app of applications) {
      const status = app?.status as TrackedStatus;
      if (!TRACKED_STATUSES.includes(status)) continue;
      if (options.status && status !== options.status) continue;
      if (options.country && app.country !== options.country) continue;

      const sinceSource: LateApplication['sinceSource'] = app.updatedAt ? 'application' : 'student';
      const since = app.updatedAt || student.createdAt;
      const daysInStatus = daysBetween(since, now);
      if (daysInStatus === null) continue;

      const thresholdDays = rules.daysByStatus[status];
      const daysOverdue = daysInStatus - thresholdDays;
      if (daysOverdue < 1) continue;

      found.push({
        studentId: doc.id,
        studentName: student.name ?? '(unnamed)',
        employeeId: student.employeeId ?? null,
        university: app.university ?? '(no university)',
        major: app.major ?? '(no major)',
        country: app.country,
        status,
        since: since as string,
        sinceSource,
        daysInStatus,
        thresholdDays,
        daysOverdue,
      });
    }
  }

  found.sort((a, b) => b.daysOverdue - a.daysOverdue);

  const byStatus = { Pending: 0, Submitted: 0, 'Missing Items': 0 } as Record<TrackedStatus, number>;
  const employeeCounts = new Map<string | null, number>();
  for (const row of found) {
    byStatus[row.status]++;
    employeeCounts.set(row.employeeId, (employeeCounts.get(row.employeeId) ?? 0) + 1);
  }

  return {
    rules,
    caveat: LATE_DATA_CAVEAT,
    studentsScanned,
    totalLate: found.length,
    byStatus,
    byEmployee: Array.from(employeeCounts.entries())
      .map(([employeeId, count]) => ({ employeeId, count }))
      .sort((a, b) => b.count - a.count),
    returned: Math.min(found.length, limit),
    applications: found.slice(0, limit),
  };
}
