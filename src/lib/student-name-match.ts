// Telling a duplicate apart from a brother or sister.
//
// Students routinely give a parent's phone number, so two siblings legitimately share
// one. A warning that treats every shared number as a duplicate would cry wolf, and be
// ignored by the time it matters.
//
// Kuwaiti names carry the family: <given> <father> <grandfather> <family>. Siblings
// therefore differ only in the given name and agree on everything after it, while a
// genuine duplicate is the same name twice.
//
// Measured over the real data — 71 shared phone numbers — this separates 55 duplicate
// pairs from 14 sibling pairs and 6 unrelated ones.

export type NameRelation = 'same-student' | 'same-family' | 'unrelated';

/** Lower-case, punctuation-free tokens. Keeps Arabic letters (\p{L} covers them). */
function tokens(name: string | null | undefined): string[] {
  return (name ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    // Closing a profile appends "-Closed" to the name, which would otherwise look like
    // the family name and stop every closed student from ever matching a sibling.
    .filter(t => t !== 'closed');
}

/**
 * How an existing student relates to the one being entered.
 *
 * Returns 'unrelated' when there is not enough of a name to judge — better to say
 * nothing than to guess at a relationship.
 */
export function classifyNameRelation(
  typedName: string | null | undefined,
  existingName: string | null | undefined,
): NameRelation {
  const a = tokens(typedName);
  const b = tokens(existingName);
  if (a.length === 0 || b.length === 0) return 'unrelated';

  if (a.join(' ') === b.join(' ')) return 'same-student';

  if (a.length < 2 || b.length < 2) return 'unrelated';

  const familyA = a[a.length - 1];
  const familyB = b[b.length - 1];
  if (familyA === familyB) return 'same-family';

  // Some names carry a note where the family name should be ("محمد الضبيان - ايلتس"),
  // so also accept the family name appearing anywhere in the other name. Short tokens
  // are ignored: initials like "M" or "KH" would otherwise match anything. This only
  // ever runs on two students who already share a number, so the bar can be this low.
  const MIN_MEANINGFUL = 3;
  if (familyA.length >= MIN_MEANINGFUL && b.includes(familyA)) return 'same-family';
  if (familyB.length >= MIN_MEANINGFUL && a.includes(familyB)) return 'same-family';

  return 'unrelated';
}

/** Ordering for display: the concerning match first, the harmless one last. */
export const RELATION_ORDER: Record<NameRelation, number> = {
  'same-student': 0,
  'unrelated': 1,
  'same-family': 2,
};
