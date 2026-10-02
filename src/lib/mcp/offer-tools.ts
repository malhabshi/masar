// Discovery for "which offers do our students actually hold, and where is the letter?"
//
// list_students caps at 100 with no pagination and cannot filter by application country,
// status or study level, so building a one-row-per-offer reference table meant reading
// the whole database by hand. These two tools do the scan and the de-duplication on the
// server, where there is no cap, and hand back the studentId/documentId pairs that
// read_student_document needs.
import { adminDb } from '@/lib/firebase/admin';
import { mimeFromName } from '@/lib/mcp/document-tools';

/** Study levels actually stored on students, for error messages that help the caller. */
export const KNOWN_STUDY_LEVELS = ['Foundation', 'First Year', 'Transfer Student'] as const;
/** Countries actually stored on applications. */
export const KNOWN_COUNTRIES = ['UK', 'USA', 'Australia', 'New Zealand'] as const;
/** Application statuses actually stored. */
export const KNOWN_STATUSES = ['Accepted', 'Rejected', 'Submitted', 'Pending', 'Missing Items'] as const;

interface StoredApplication {
  university?: string;
  major?: string;
  country?: string;
  status?: string;
}

interface StoredDoc {
  id?: string;
  name?: string;
  originalName?: string;
  uploadedAt?: string;
}

interface ScannedStudent {
  id: string;
  name: string;
  studyLevel: string;
  isClosed: boolean;
  applications: StoredApplication[];
  documents: StoredDoc[];
}

export interface OfferRow {
  university: string;
  major: string;
  country: string;
  studentCount: number;
  sampleStudentId: string;
  sampleStudentName: string;
  sampleDocumentId: string | null;
  sampleDocumentName: string | null;
  allStudentIds: string[];
}

/** Trailing spaces and inconsistent capitalisation are both present in this data
 *  ("Pharmacology" and "pharmacology" on the same student), so every comparison and
 *  every grouping key goes through this. */
const norm = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** Curly vs straight apostrophes differ between university names and document names
 *  ("Queen’s" / "Queen's"), which would otherwise break document matching. */
const normName = (v: unknown): string => norm(v).replace(/[’‘`]/g, "'");

async function scanStudents(): Promise<ScannedStudent[]> {
  if (!adminDb) throw new Error('Database is not available.');
  // Field mask: the full student documents are large and none of the rest is needed.
  const snap = await adminDb
    .collection('students')
    .select('name', 'studyLevel', 'applications', 'documents', 'isClosed')
    .get();
  return snap.docs.map(d => {
    const x = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      name: String(x.name ?? ''),
      studyLevel: String(x.studyLevel ?? ''),
      isClosed: !!x.isClosed,
      applications: Array.isArray(x.applications) ? (x.applications as StoredApplication[]) : [],
      documents: Array.isArray(x.documents) ? (x.documents as StoredDoc[]) : [],
    };
  });
}

/** The document on this student that looks like the offer letter for `university`.
 *  Staff name these documents after the university itself, so an exact normalised match
 *  is reliable; a PDF wins over an image because it can be read as text. */
function matchDocument(student: ScannedStudent, university: string): StoredDoc | null {
  const want = normName(university);
  if (!want) return null;
  const hits = student.documents.filter(d => d.id && normName(d.name) === want);
  if (!hits.length) return null;
  const score = (d: StoredDoc) => {
    const mime = mimeFromName(d.originalName || d.name || '');
    if (mime === 'application/pdf') return 2;
    if (mime.startsWith('image/')) return 1;
    return 0;
  };
  return [...hits].sort((a, b) => score(b) - score(a) || String(b.uploadedAt ?? '').localeCompare(String(a.uploadedAt ?? '')))[0];
}

interface Group {
  university: string;
  major: string;
  country: string;
  /** Original spellings seen, so the row shows the most common one rather than whichever
   *  student happened to be scanned first. */
  spellings: Map<string, number>;
  students: ScannedStudent[];
}

const commonest = (counts: Map<string, number>, fallback: string) =>
  [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? fallback;

/**
 * One row per distinct university + major + country, across every student.
 *
 * Scans the whole students collection server-side — there is no 100-row cap here.
 * `countries` and `status` filter the applications; `level` filters the students.
 */
export async function listAcceptedOffers(params: {
  countries?: string[];
  level?: string;
  status?: string;
  includeClosed?: boolean;
}) {
  const countries = (params.countries || []).map(norm).filter(Boolean);
  const status = norm(params.status || 'Accepted');
  const level = params.level ? norm(params.level) : null;
  const includeClosed = params.includeClosed !== false;

  const all = await scanStudents();
  const students = includeClosed ? all : all.filter(s => !s.isClosed);

  const levelMatched = level ? students.filter(s => norm(s.studyLevel) === level) : students;

  const groups = new Map<string, Group>();
  for (const student of levelMatched) {
    for (const app of student.applications) {
      if (!app.university) continue;
      if (countries.length && !countries.includes(norm(app.country))) continue;
      if (status && norm(app.status) !== status) continue;

      const key = `${normName(app.university)}||${norm(app.major)}||${norm(app.country)}`;
      let g = groups.get(key);
      if (!g) {
        g = { university: '', major: '', country: String(app.country ?? ''), spellings: new Map(), students: [] };
        groups.set(key, g);
      }
      const spelling = `${String(app.university).trim()}||${String(app.major ?? '').trim()}`;
      g.spellings.set(spelling, (g.spellings.get(spelling) || 0) + 1);
      // The same student can hold the same offer twice (duplicate application rows).
      if (!g.students.some(s => s.id === student.id)) g.students.push(student);
    }
  }

  const offers: OfferRow[] = [...groups.values()].map(g => {
    const [university, major] = commonest(g.spellings, '||').split('||');
    // Prefer a student who actually has the letter, and an open profile over a closed one.
    const ranked = [...g.students]
      .map(s => ({ s, doc: matchDocument(s, university) }))
      .sort((a, b) =>
        Number(!!b.doc) - Number(!!a.doc) ||
        Number(a.s.isClosed) - Number(b.s.isClosed) ||
        b.s.documents.length - a.s.documents.length);
    const best = ranked[0];
    return {
      university,
      major,
      country: g.country,
      studentCount: g.students.length,
      sampleStudentId: best.s.id,
      sampleStudentName: best.s.name,
      sampleDocumentId: best.doc?.id ?? null,
      sampleDocumentName: best.doc?.name ?? null,
      allStudentIds: g.students.map(s => s.id),
    };
  }).sort((a, b) => b.studentCount - a.studentCount || a.university.localeCompare(b.university) || a.major.localeCompare(b.major));

  const result: Record<string, unknown> = {
    offers,
    totalUniqueOffers: offers.length,
    totalStudentsScanned: students.length,
    offersWithDocument: offers.filter(o => o.sampleDocumentId).length,
    filters: { countries: params.countries || [], level: params.level ?? null, status: params.status || 'Accepted', includeClosed },
  };

  // An unknown level silently returning zero rows is the worst outcome here, so say so.
  if (level && levelMatched.length === 0) {
    result.note = `No student has studyLevel "${params.level}". Stored values are: ${KNOWN_STUDY_LEVELS.join(', ')} (plus students with none set). There is no "Bachelor" level in this system — "First Year" is the bachelor-entry level.`;
  } else if (!offers.length) {
    result.note = `No applications matched. Countries stored: ${KNOWN_COUNTRIES.join(', ')}. Statuses stored: ${KNOWN_STATUSES.join(', ')}.`;
  }

  return result;
}

/**
 * Other students holding the same offer, with their matching documents.
 *
 * The fallback for when a row's sampleDocumentId turns out to be a scan or the wrong
 * file: pick another candidate without re-running discovery.
 */
export async function getOfferDocumentCandidates(university: string, major?: string) {
  const wantUni = normName(university);
  const wantMajor = major ? norm(major) : null;
  if (!wantUni) throw new Error('university is required.');

  const students = await scanStudents();
  const candidates: { studentId: string; studentName: string; documentId: string; documentName: string; mimeType: string; isClosed: boolean }[] = [];

  for (const student of students) {
    const holds = student.applications.some(a =>
      normName(a.university) === wantUni && (!wantMajor || norm(a.major) === wantMajor));
    if (!holds) continue;
    for (const d of student.documents) {
      if (!d.id || normName(d.name) !== wantUni) continue;
      candidates.push({
        studentId: student.id,
        studentName: student.name,
        documentId: d.id,
        documentName: d.name || '',
        mimeType: mimeFromName(d.originalName || d.name || ''),
        isClosed: student.isClosed,
      });
    }
  }

  // PDFs first: they can be read as text.
  candidates.sort((a, b) =>
    Number(b.mimeType === 'application/pdf') - Number(a.mimeType === 'application/pdf') ||
    Number(a.isClosed) - Number(b.isClosed));

  return { university, major: major ?? null, count: candidates.length, candidates };
}
