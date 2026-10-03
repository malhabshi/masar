// Telling whether two university names mean the same school, as the agency writes them:
// "University of Liverpool - kaplan", "City St George's, University of London",
// "Keele University  - Navitas". Providers and filler words are dropped and what is left
// is compared.

const STOP = new Set([
  'university', 'of', 'the', 'college', 'international', 'study', 'centre', 'center', 'school', 'and', 'into',
  'kaplan', 'navitas', 'oncampus', 'on', 'compus', 'campus', 'group', 'in', 'house', 'isc', 'pathway',
  'pathways', 'london', 'ic', 'uc', 'via',
]);

export function universityWords(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}

/** The same school: exactly the same distinctive words. "East London" is not "East Anglia". */
export function sameUniversity(a: string, b: string): boolean {
  const wa = universityWords(a);
  const wb = universityWords(b);
  return wa.size > 0 && wa.size === wb.size && [...wa].every((w) => wb.has(w));
}
