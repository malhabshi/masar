// Correcting a student's name, date of birth and civil ID, for the AI — the fields staff
// edit at the top of the profile (the date of birth and civil ID live in jotformData, where
// the JotForm forms read them). The profile writes them from the browser; this is the
// server-side way, kept out of the 'use server' actions on purpose: a server action can be
// called from any browser with any author id, and these are identity details.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

export type IdentityField = 'name' | 'dob' | 'civilId';
export type IdentityChange = { field: IdentityField; path: string; label: string; from: string | null; to: string };

const PATHS: Record<IdentityField, { path: string; label: string }> = {
  name: { path: 'name', label: 'name' },
  dob: { path: 'jotformData.dob', label: 'date of birth' },
  civilId: { path: 'jotformData.civilId', label: 'civil ID' },
};

/** A Kuwaiti civil ID's first seven digits are the birth date: 2 = 1900s, 3 = 2000s, then YYMMDD. */
export function dobFromCivilId(civilId: string): string | null {
  const m = civilId.match(/^([23])(\d{2})(\d{2})(\d{2})\d{5}$/);
  if (!m) return null;
  const date = `${m[1] === '2' ? '19' : '20'}${m[2]}-${m[3]}-${m[4]}`;
  return validDate(date) ? date : null;
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Set any of the three on one student. The civil ID must agree with the date of birth it
 * encodes and not be on another student, unless staff confirmed it. Callers check who is
 * asking. Never throws.
 */
export async function updateStudentIdentity(input: {
  studentId: string;
  fields: { name?: string; dob?: string; civilId?: string };
  by: { id: string; name: string };
  /** Staff confirmed the values despite a warning (a mismatch with the date of birth, or a duplicate). */
  confirmed?: boolean;
  dryRun?: boolean;
}): Promise<{ ok: true; changes: IdentityChange[]; unchanged: string[] } | { ok: false; error: string }> {
  if (!adminDb) return { ok: false, error: 'Database not available.' };
  try {
    const ref = adminDb.collection('students').doc(input.studentId);
    const s = (await ref.get()).data();
    if (!s) return { ok: false, error: 'Student not found.' };
    const current: Record<IdentityField, string | null> = {
      name: s.name ?? null,
      dob: s.jotformData?.dob ?? null,
      civilId: s.jotformData?.civilId ?? null,
    };

    const next: Partial<Record<IdentityField, string>> = {};
    if (typeof input.fields.name === 'string' && input.fields.name.trim()) {
      let name = input.fields.name.replace(/\s+/g, ' ').trim();
      if (name.length < 2 || name.length > 120) return { ok: false, error: 'Not changed: a name must be 2–120 characters.' };
      // A closed profile keeps its marker.
      if (current.name?.endsWith('-Closed') && !name.endsWith('-Closed')) name += '-Closed';
      next.name = name;
    }
    if (typeof input.fields.dob === 'string' && input.fields.dob.trim()) {
      const dob = input.fields.dob.trim();
      if (!validDate(dob)) return { ok: false, error: 'Not changed: the date of birth must be a real date written YYYY-MM-DD.' };
      if (dob < '1940-01-01' || dob > new Date().toISOString().slice(0, 10)) return { ok: false, error: `Not changed: ${dob} is not a plausible date of birth.` };
      next.dob = dob;
    }
    if (typeof input.fields.civilId === 'string' && input.fields.civilId.trim()) {
      const civilId = input.fields.civilId.replace(/\D/g, '');
      if (civilId.length !== 12) return { ok: false, error: 'Not changed: a civil ID has 12 digits.' };
      next.civilId = civilId;
    }
    if (!Object.keys(next).length) return { ok: false, error: 'Nothing to change: give a name, date of birth or civil ID.' };

    // A new date of birth must agree with the civil ID already on file, too.
    if (next.dob && !next.civilId && current.civilId && !input.confirmed) {
      const encoded = dobFromCivilId(current.civilId);
      if (encoded && encoded !== next.dob) {
        return {
          ok: false,
          error: `Not changed: the civil ID on file (${current.civilId}) encodes the birth date ${encoded}, not ${next.dob}. Ask staff to check the passport and confirm.`,
        };
      }
    }
    if (next.civilId && !input.confirmed) {
      const encoded = dobFromCivilId(next.civilId);
      const dob = next.dob ?? current.dob;
      if (dob && encoded !== dob) {
        return {
          ok: false,
          error: `Not changed: civil ID ${next.civilId} ${encoded ? `encodes the birth date ${encoded}` : 'does not encode a valid birth date'}, but the date of birth is ${dob}. Ask staff to check it against the civil ID card and confirm.`,
        };
      }
      const others = (await adminDb.collection('students').where('jotformData.civilId', '==', next.civilId).get()).docs.filter(
        (d) => d.id !== input.studentId,
      );
      if (others.length) {
        return {
          ok: false,
          error: `Not changed: civil ID ${next.civilId} is already on ${others.map((d) => d.data().name).join(', ')}. Ask staff to confirm before saving it here too.`,
        };
      }
    }

    const changes: IdentityChange[] = [];
    const unchanged: string[] = [];
    for (const field of Object.keys(next) as IdentityField[]) {
      if (current[field] === next[field]) unchanged.push(`${PATHS[field].label} is already ${next[field]}`);
      else changes.push({ field, ...PATHS[field], from: current[field], to: next[field]! });
    }
    if (!changes.length || input.dryRun) return { ok: true, changes, unchanged };

    const now = new Date().toISOString();
    await ref.update({
      ...Object.fromEntries(changes.map((c) => [c.path, c.to])),
      lastActivityAt: now,
      adminNotes: FieldValue.arrayUnion({
        id: `note-identity-${Date.now()}`,
        authorId: input.by.id,
        content: `${input.by.name} (via Masar AI) set ${changes.map((c) => `${c.label}: ${c.from ?? '(empty)'} → ${c.to}`).join('; ')}.`,
        createdAt: now,
      }),
    });
    return { ok: true, changes, unchanged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
