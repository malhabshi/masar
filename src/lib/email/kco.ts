// "Not approved by the KCO" — checked against the agency's own Approved Universities list.
//
// Companies sometimes get KCO approval wrong (Merit once said City St George's Radiography
// was not approved; the agency's list says it is). A wrong claim, acted on, rejects
// applications — and as a company notice, rejects them for every student and closes the
// course on the list. So the list decides: when an email says a course is not approved
// but the list shows it as approved, nothing is changed and a person is asked to confirm
// with the KCO.

import { adminDb } from '@/lib/firebase/admin';
import { sameUniversity } from './universities';

/** Words that point at KCO / MOHE approval, for when the model does not say so itself. */
const KCO_WORDS = /\bKCO\b|cultural office|\bMOHE\b|not (be )?(KCO[- ])?approved|unapproved|غير معتمد|الملحقي|المكتب الثقافي/i;

export function aboutKcoApproval(flag: unknown, ...texts: string[]): boolean {
  return flag === true || KCO_WORDS.test(texts.join(' '));
}

const COURSE_STOP = new Set([
  'foundation', 'first', 'year', 'bsc', 'msc', 'hons', 'with', 'and', 'the', 'of', 'in', 'degree', 'bachelor',
  'certificate', 'international', 'programme', 'program', 'year1', 'one', 'sciences',
]);
const words = (s: string, stop: Set<string>) =>
  new Set(s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !stop.has(w)));

function sameCourse(a: string, b: string): boolean {
  const wa = words(a, COURSE_STOP);
  const wb = words(b, COURSE_STOP);
  return [...wa].some((w) => wb.has(w) || [...wb].some((x) => x.startsWith(w.slice(0, 6)) || w.startsWith(x.slice(0, 6))));
}

/**
 * The Approved Universities rows that show this university (and course, when given) as
 * approved and open. Empty when the list does not back it up — or cannot be read, in which
 * case the email's claim is acted on as before.
 */
export async function approvedRowsFor(university: string, course: string | null): Promise<string[]> {
  if (!adminDb) return [];
  try {
    const snap = await adminDb.collection('approved_universities').get();
    return snap.docs
      .map((d) => d.data() as { name?: string; major?: string; isAvailable?: boolean })
      .filter((u) => u.isAvailable !== false && sameUniversity(String(u.name ?? ''), university))
      .filter((u) => !course || sameCourse(String(u.major ?? ''), course))
      .map((u) => `${u.name} — ${u.major}`);
  } catch {
    return [];
  }
}
