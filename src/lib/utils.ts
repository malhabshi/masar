import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Calculate a person's age in whole years from a date-of-birth string.
 * DOBs are stored as ISO `YYYY-MM-DD` (from an <input type="date">), but this
 * also tolerates other parseable formats. Returns null when the value is
 * missing, unparseable, or yields an implausible age (guards against typos
 * like "20008-04-06").
 */
export function calculateAge(dob?: string | null): number | null {
  if (!dob) return null;
  const trimmed = String(dob).trim();
  if (!trimmed) return null;

  let birth: Date | null = null;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    birth = new Date(Number(y), Number(m) - 1, Number(d));
  } else {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) birth = parsed;
  }

  if (!birth || isNaN(birth.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }

  // Reject implausible ages (typos, bad data).
  if (age < 0 || age > 120) return null;

  return age;
}
