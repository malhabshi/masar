// Exact counts for the AI assistant.
//
// The model must never estimate a number, so it needs a way to get one for any question
// staff ask: "how many UK students are accepted", "how many applications are pending per
// employee", "how many IELTS requests are still new". Everything here is computed from a
// full read of the relevant collection, never sampled, and the answer always carries the
// filters that produced it so the model can state them.
//
// Students and applications come from one scan of `students` (applications live inside
// the student document). Tasks reuse the request-only filtering in task-tools so a count
// here matches what the /tasks page shows.

import { adminDb } from '@/lib/firebase/admin';
import { countTasks, fetchAllRequestTasks } from '@/lib/mcp/task-tools';
import type { TaskStatus } from '@/lib/types';

export type CountEntity = 'students' | 'applications' | 'tasks';

export type CountFilters = {
  employeeId?: string;
  pipelineStatus?: string;
  /** Students: in targetCountries. Applications: the application's own country. */
  country?: string;
  applicationStatus?: string;
  /** Case-insensitive substring. */
  university?: string;
  /** Case-insensitive substring. */
  major?: string;
  studyLevel?: string;
  term?: string;
  intakeYear?: number;
  intakeSemester?: string;
  gender?: string;
  schoolType?: string;
  jotform?: boolean;
  finalized?: boolean;
  changeAgentRequired?: boolean;
  hasMissingItems?: boolean;
  ieltsMin?: number;
  ieltsMax?: number;
  /** 'exclude' (default) | 'only' | 'include' */
  closed?: 'exclude' | 'only' | 'include';
  /** ISO dates, inclusive. Students: createdAt. Applications: updatedAt. Tasks: createdAt. */
  from?: string;
  to?: string;
  // Tasks only
  taskStatus?: TaskStatus;
  taskType?: string;
  recipientId?: string;
};

export type CountGroupBy =
  | 'none'
  | 'employee'
  | 'country'
  | 'applicationStatus'
  | 'university'
  | 'pipelineStatus'
  | 'studyLevel'
  | 'term'
  | 'intake'
  | 'month'
  | 'gender'
  | 'taskType'
  | 'taskStatus';

const STUDENT_FIELDS = [
  'name', 'employeeId', 'pipelineStatus', 'targetCountries', 'applications', 'studyLevel',
  'term', 'academicIntakeYear', 'academicIntakeSemester', 'gender', 'schoolType', 'jotform',
  'finalChoiceUniversity', 'changeAgentRequired', 'missingItems', 'ieltsOverall', 'isClosed',
  'createdAt',
];

/** Above this, a breakdown is cut to the largest groups and says how many it left out. */
const MAX_GROUPS = 40;
const MAX_NAMES = 50;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const contains = (hay: unknown, needle?: string) => !needle || lc(hay).includes(lc(needle));
const inRange = (iso: unknown, from?: string, to?: string) => {
  const d = String(iso ?? '').slice(0, 10);
  if (!from && !to) return true;
  if (!d) return false;
  if (from && d < from.slice(0, 10)) return false;
  if (to && d > to.slice(0, 10)) return false;
  return true;
};

async function employeeNames(): Promise<Map<string, string>> {
  const snap = await db().collection('users').get();
  const out = new Map<string, string>();
  snap.docs.forEach((d) => {
    const u = d.data();
    if (u.civilId) out.set(String(u.civilId), u.name ?? String(u.civilId));
    out.set(d.id, u.name ?? d.id);
  });
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function studentMatches(s: Row, f: CountFilters): boolean {
  const closed = f.closed ?? 'exclude';
  if (closed === 'exclude' && s.isClosed === true) return false;
  if (closed === 'only' && s.isClosed !== true) return false;
  if (f.employeeId !== undefined && String(s.employeeId ?? '') !== f.employeeId) return false;
  if (f.pipelineStatus && lc(s.pipelineStatus || 'none') !== lc(f.pipelineStatus)) return false;
  if (f.studyLevel && lc(s.studyLevel) !== lc(f.studyLevel)) return false;
  if (f.term && lc(s.term) !== lc(f.term)) return false;
  if (f.intakeYear !== undefined && Number(s.academicIntakeYear) !== Number(f.intakeYear)) return false;
  if (f.intakeSemester && lc(s.academicIntakeSemester) !== lc(f.intakeSemester)) return false;
  if (f.gender && lc(s.gender) !== lc(f.gender)) return false;
  if (f.schoolType && lc(s.schoolType) !== lc(f.schoolType)) return false;
  if (f.jotform !== undefined && (s.jotform === true) !== f.jotform) return false;
  if (f.finalized !== undefined && !!s.finalChoiceUniversity !== f.finalized) return false;
  if (f.changeAgentRequired !== undefined && (s.changeAgentRequired === true) !== f.changeAgentRequired) return false;
  if (f.hasMissingItems !== undefined && (Array.isArray(s.missingItems) && s.missingItems.length > 0) !== f.hasMissingItems) return false;
  const ielts = typeof s.ieltsOverall === 'number' ? s.ieltsOverall : undefined;
  if (f.ieltsMin !== undefined && (ielts === undefined || ielts < f.ieltsMin)) return false;
  if (f.ieltsMax !== undefined && (ielts === undefined || ielts > f.ieltsMax)) return false;
  return true;
}

function appMatches(a: Row, f: CountFilters): boolean {
  if (f.country && lc(a.country) !== lc(f.country)) return false;
  if (f.applicationStatus && lc(a.status) !== lc(f.applicationStatus)) return false;
  if (!contains(a.university, f.university)) return false;
  if (!contains(a.major, f.major)) return false;
  return true;
}

function groupKey(by: CountGroupBy, s: Row, a: Row | null, names: Map<string, string>): string[] {
  switch (by) {
    case 'employee':
      return [s.employeeId ? names.get(String(s.employeeId)) ?? `Unknown (${s.employeeId})` : 'Unassigned'];
    case 'country':
      if (a) return [a.country || 'No country'];
      return Array.isArray(s.targetCountries) && s.targetCountries.length ? s.targetCountries : ['No target country'];
    case 'applicationStatus':
      if (a) return [a.status || 'No status'];
      return Array.from(new Set((s.applications ?? []).map((x: Row) => x.status || 'No status'))) as string[];
    case 'university':
      if (a) return [a.university || 'No university'];
      return Array.from(new Set((s.applications ?? []).map((x: Row) => x.university || 'No university'))) as string[];
    case 'pipelineStatus':
      return [s.pipelineStatus || 'none'];
    case 'studyLevel':
      return [s.studyLevel || 'Not set'];
    case 'term':
      return [s.term || 'Not set'];
    case 'intake':
      return [s.academicIntakeYear ? `${s.academicIntakeSemester ?? ''} ${s.academicIntakeYear}`.trim() : 'Not set'];
    case 'month':
      return [String((a ? a.updatedAt : s.createdAt) ?? '').slice(0, 7) || 'Unknown'];
    case 'gender':
      return [s.gender || 'Not set'];
    default:
      return ['all'];
  }
}

function finishBreakdown(groups: Map<string, number>) {
  const sorted = Array.from(groups.entries()).sort((x, y) => y[1] - x[1]);
  const shown = sorted.slice(0, MAX_GROUPS).map(([group, count]) => ({ group, count }));
  return sorted.length > MAX_GROUPS
    ? { breakdown: shown, groupsNotShown: sorted.length - MAX_GROUPS }
    : { breakdown: shown };
}

async function countStudentsOrApplications(
  entity: 'students' | 'applications',
  f: CountFilters,
  groupBy: CountGroupBy,
  listNames: boolean,
) {
  const [snap, names] = await Promise.all([
    db().collection('students').select(...STUDENT_FIELDS).get(),
    groupBy === 'employee' ? employeeNames() : Promise.resolve(new Map<string, string>()),
  ]);

  const groups = new Map<string, number>();
  const bump = (keys: string[]) => keys.forEach((k) => groups.set(k, (groups.get(k) ?? 0) + 1));
  const matchedNames: string[] = [];
  const appFilterSet = !!(f.country || f.applicationStatus || f.university || f.major);
  let total = 0;

  for (const doc of snap.docs) {
    const s = doc.data();
    if (!studentMatches(s, f)) continue;
    const apps: Row[] = Array.isArray(s.applications) ? s.applications : [];

    if (entity === 'applications') {
      for (const a of apps) {
        if (!appMatches(a, f) || !inRange(a.updatedAt, f.from, f.to)) continue;
        total++;
        if (groupBy !== 'none') bump(groupKey(groupBy, s, a, names));
        if (listNames && matchedNames.length < MAX_NAMES) matchedNames.push(`${s.name} — ${a.university} (${a.status})`);
      }
      continue;
    }

    // Students: a country filter means "targets this country OR has an application there".
    if (!inRange(s.createdAt, f.from, f.to)) continue;
    if (appFilterSet) {
      const countryOnly = f.country && !f.applicationStatus && !f.university && !f.major;
      const targets = Array.isArray(s.targetCountries) && s.targetCountries.some((c: string) => lc(c) === lc(f.country));
      const viaApps = apps.some((a) => appMatches(a, f));
      if (!(viaApps || (countryOnly && targets))) continue;
    }
    total++;
    if (groupBy !== 'none') bump(groupKey(groupBy, s, null, names));
    if (listNames && matchedNames.length < MAX_NAMES) matchedNames.push(String(s.name ?? doc.id));
  }

  return {
    total,
    ...(groupBy !== 'none' ? finishBreakdown(groups) : {}),
    ...(listNames ? { names: matchedNames, namesTruncated: total > matchedNames.length } : {}),
    scanned: snap.size,
  };
}

async function countTaskRecords(f: CountFilters, groupBy: CountGroupBy) {
  const opts = { status: f.taskStatus, recipientId: f.recipientId, taskType: f.taskType };
  if (groupBy === 'none' && !f.from && !f.to) return { total: (await countTasks(opts)).count };

  // Need the rows themselves for a date range or a breakdown.
  const { tasks: rows, capped } = await fetchAllRequestTasks(opts);

  const groups = new Map<string, number>();
  let total = 0;
  for (const t of rows) {
    if (!inRange(t.createdAt, f.from, f.to)) continue;
    total++;
    if (groupBy === 'none') continue;
    const key =
      groupBy === 'taskType' ? String(t.taskType ?? 'No type').trim()
      : groupBy === 'taskStatus' ? String(t.status ?? 'new')
      : groupBy === 'month' ? String(t.createdAt ?? '').slice(0, 7) || 'Unknown'
      : groupBy === 'employee' ? (t.recipientNames?.join(', ') || 'No recipient')
      : 'all';
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return {
    total,
    ...(groupBy !== 'none' ? finishBreakdown(groups) : {}),
    ...(capped ? { capped: true, note: 'More than 5000 tasks matched the base query; the count may be low.' } : {}),
  };
}

export async function countRecords(input: {
  entity: CountEntity;
  filters?: CountFilters;
  groupBy?: CountGroupBy;
  listNames?: boolean;
}) {
  const filters = input.filters ?? {};
  const groupBy = input.groupBy ?? 'none';
  const result =
    input.entity === 'tasks'
      ? await countTaskRecords(filters, groupBy)
      : await countStudentsOrApplications(input.entity, filters, groupBy, !!input.listNames);
  return {
    entity: input.entity,
    filtersApplied: { closed: input.entity === 'tasks' ? undefined : filters.closed ?? 'exclude', ...filters },
    groupBy,
    ...result,
  };
}
