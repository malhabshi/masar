// How many schools a student may take from one pathway company.
//
// The rule: at most 5 DISTINCT SCHOOLS per company. Five Kaplan and five INTO at the
// same time is fine; six Kaplan is not. Different majors at the same school count once.
//
// The count is of what the student HOLDS, not of what they have ever been given — the
// schools already on their profile plus the ones being picked now. Remove a school and
// its place frees up immediately.
//
// 'Inhouse' is exempt: those are not a partner company's allocation.

export const COMPANY_LIMIT = 5;

/**
 * Company names appear inside school names as well as in the company field, spelled
 * every which way: "University of Nottingham - Kaplan", "... - kaplan", and plain
 * "University of Nottingham" are one school, and were previously counted as three —
 * burning three of the five Kaplan places.
 */
const COMPANY_WORDS =
  /\b(into|kaplan|study\s*group|studygroup|on\s*camp?us|on\s*compus|oncampus|navitas|in\s*house|inhouse|qa)\b/g;

/** One school, regardless of how the name was typed. */
export function schoolKey(name: string | null | undefined): string {
  return (name ?? '')
    .toLowerCase()
    .replace(COMPANY_WORDS, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type ApprovedLike = {
  name: string;
  country?: string | null;
  company?: string | null;
};

/**
 * Look up a school's company by name. Built from the approved-universities list, so a
 * school recorded on a student can be traced back to its company even though the
 * application itself only stores a name.
 */
export function buildCompanyLookup(approved: ApprovedLike[] | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const u of approved ?? []) {
    const company = (u.company ?? '').trim();
    if (!company) continue;
    const key = schoolKey(u.name);
    if (key) map.set(key, company);
  }
  return map;
}

export type CountedSchool = { name: string; company: string };

/**
 * Distinct schools per company. `Inhouse` and anything with no company are ignored —
 * they are not limited.
 */
export function countByCompany(schools: CountedSchool[]): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const s of schools) {
    const company = (s.company ?? '').trim();
    if (!company || company === 'Inhouse') continue;
    const key = schoolKey(s.name);
    if (!key) continue;
    (out[company] ??= new Set()).add(key);
  }
  return out;
}

/**
 * The UK schools a student already holds, resolved to their companies.
 *
 * Reads the student's live applications, so a school that has been removed no longer
 * takes up a place.
 */
export function schoolsAlreadyHeld(
  applications: { university?: string | null; country?: string | null }[] | null | undefined,
  lookup: Map<string, string>,
): CountedSchool[] {
  const held: CountedSchool[] = [];
  for (const app of applications ?? []) {
    const name = app?.university;
    if (!name) continue;
    const company = lookup.get(schoolKey(name));
    if (company) held.push({ name, company });
  }
  return held;
}

/**
 * Schools tied up by requests that are still open.
 *
 * A school is picked one request at a time, and it only reaches the student's
 * applications once that request is completed — so five separate open requests would
 * otherwise slip past the limit together. Completed requests are NOT counted here:
 * their school is already an application, and counting both would keep a place
 * occupied after the school had been removed from the student.
 */
export function schoolsInOpenRequests(
  tasks: { status?: string | null; category?: string | null; data?: unknown }[] | null | undefined,
  lookup: Map<string, string>,
): CountedSchool[] {
  const open: CountedSchool[] = [];
  for (const task of tasks ?? []) {
    if (task?.category !== 'request') continue;
    if (task.status !== 'new' && task.status !== 'in-progress') continue;

    const data = (task.data ?? {}) as {
      selectedGlobalUniversityDetails?: { name?: string };
      selectedGlobalUniversities?: { name?: string }[];
    };
    const names = [
      data.selectedGlobalUniversityDetails?.name,
      ...(data.selectedGlobalUniversities ?? []).map(u => u?.name),
    ];
    for (const name of names) {
      if (!name) continue;
      const company = lookup.get(schoolKey(name));
      if (company) open.push({ name, company });
    }
  }
  return open;
}

/**
 * Whether one more school from this company would break the limit.
 *
 * Picking a school the student already holds is always allowed — it takes no new place.
 */
export function wouldExceedLimit(
  candidate: { name: string; company?: string | null },
  current: Record<string, Set<string>>,
): boolean {
  const company = (candidate.company ?? '').trim();
  if (!company || company === 'Inhouse') return false;
  const taken = current[company];
  if (!taken) return false;
  if (taken.has(schoolKey(candidate.name))) return false; // already counted
  return taken.size >= COMPANY_LIMIT;
}
