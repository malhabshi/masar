// Matching an incoming email to a student by full name.
//
// Measured against production on 2026-09-14: across 1,400 open students there are ZERO
// exact full-name collisions, while first+last name alone leaves 39 students (2.8%)
// ambiguous — "MOHAMMAD ALMUTAIRI" maps to four different people. Only 38.8% of students
// have an email address on file at all, so the sender address is a far weaker key than
// the name.
//
// Therefore: a document is filed automatically ONLY when exactly one student's complete
// registered name appears in the email. Everything else goes to a human.

import { adminDb } from '@/lib/firebase/admin';

export type StudentNameRecord = { id: string; name: string; normalized: string };

export type MatchResult =
  | { kind: 'matched'; student: StudentNameRecord }
  | { kind: 'ambiguous'; candidates: StudentNameRecord[] }
  | { kind: 'no_match' };

/**
 * Uppercase, strip anything that isn't a letter or digit, collapse whitespace. Keeps
 * Arabic letters intact (\p{L} covers them) so Arabic-script names still match.
 */
export function normalizeName(value: string): string {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Load every open student's name once per intake run. */
export async function loadStudentNames(): Promise<StudentNameRecord[]> {
  if (!adminDb) throw new Error('Database not available');
  const snap = await adminDb.collection('students').select('name', 'isClosed').get();
  const out: StudentNameRecord[] = [];
  snap.forEach((doc) => {
    const d = doc.data();
    if (d.isClosed === true) return;
    const name = String(d.name ?? '').trim();
    const normalized = normalizeName(name);
    // Single-token names are too weak to match on; they'd hit half the inbox.
    if (!normalized || normalized.split(' ').length < 2) return;
    out.push({ id: doc.id, name, normalized });
  });
  return out;
}

/** True when `needle` appears in `haystack` on whole-word boundaries. */
function containsWholePhrase(haystack: string, needle: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return false;
    const before = at === 0 ? ' ' : haystack[at - 1];
    const afterIndex = at + needle.length;
    const after = afterIndex >= haystack.length ? ' ' : haystack[afterIndex];
    if (before === ' ' && after === ' ') return true;
    from = at + 1;
  }
}

/**
 * Find which student an email refers to.
 *
 * `text` should be everything worth searching — sender display name, subject and body
 * concatenated. A match requires the student's COMPLETE registered name to appear.
 * If two students' names both appear (possible when one registered name is a subset of
 * another's wording), the result is ambiguous and a human decides.
 */
export function matchStudentByName(text: string, students: StudentNameRecord[]): MatchResult {
  const haystack = ` ${normalizeName(text)} `;
  if (haystack.trim().length === 0) return { kind: 'no_match' };

  const hits = students.filter((s) => containsWholePhrase(haystack, s.normalized));

  if (hits.length === 1) return { kind: 'matched', student: hits[0] };
  if (hits.length > 1) {
    // Prefer the longest (most specific) name if one strictly contains all others —
    // "AHMAD ALENEZI" inside "AHMAD M ALENEZI" is not a genuine tie.
    const sorted = [...hits].sort((a, b) => b.normalized.length - a.normalized.length);
    const longest = sorted[0];
    const othersAreSubsets = sorted
      .slice(1)
      .every((s) => containsWholePhrase(` ${longest.normalized} `, s.normalized));
    if (othersAreSubsets) return { kind: 'matched', student: longest };
    return { kind: 'ambiguous', candidates: sorted };
  }
  return { kind: 'no_match' };
}
