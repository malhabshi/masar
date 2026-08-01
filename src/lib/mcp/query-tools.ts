// Read layer for the MCP. The app itself reads via client-side Firestore listeners,
// so src/lib/actions.ts is almost entirely writes. These helpers give the MCP the
// ability to SEE data (list/search/get) so it can act on it. All reads use the admin
// SDK. To avoid composite-index requirements we apply at most one equality filter in
// the query and filter any extras in memory.
import { adminDb } from '@/lib/firebase/admin';

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// Plain-object clone (strips Firestore class instances / undefined for the JSON boundary).
function scrub<T>(v: T): T {
  return JSON.parse(JSON.stringify(v ?? null));
}

type AppSummary = { university?: string; major?: string; country?: string; status?: string };

// Compact projection of a student for list/search results (full doc is large).
function studentSummary(id: string, d: Record<string, unknown>) {
  const apps = Array.isArray(d.applications) ? (d.applications as AppSummary[]) : [];
  return scrub({
    id,
    name: d.name ?? null,
    phone: d.phone ?? null,
    phone2: d.phone2 ?? null,
    phone3: d.phone3 ?? null,
    employeeId: d.employeeId ?? null,
    pipelineStatus: d.pipelineStatus ?? null,
    targetCountries: d.targetCountries ?? null,
    acceptedInfo: (d as { acceptedInfo?: unknown }).acceptedInfo ?? null,
    importListName: (d as { importListName?: unknown }).importListName ?? null,
    adminChecklistStatus: (d as { adminChecklistStatus?: unknown }).adminChecklistStatus ?? {},
    isClosed: (d as { isClosed?: unknown }).isClosed ?? false,
    changeAgentRequired: d.changeAgentRequired ?? false,
    ieltsOverall: d.ieltsOverall ?? null,
    term: d.term ?? null,
    createdAt: d.createdAt ?? null,
    applicationsCount: apps.length,
    applications: apps.map((a) => ({ university: a.university, major: a.major, country: a.country, status: a.status })),
  });
}

export type StudentFilters = {
  employeeId?: string;
  pipelineStatus?: string;
  changeAgentRequired?: boolean;
  jotform?: boolean;
  hasChangeAgentHistory?: boolean;
  limit?: number;
};

export async function listStudents(f: StudentFilters = {}) {
  const limit = Math.min(Math.max(f.limit ?? 25, 1), 100);
  const col = db().collection('students');

  // Primary (indexable) equality filter — one only, to avoid composite indexes.
  const filters: Array<[string, unknown]> = [];
  if (f.employeeId !== undefined) filters.push(['employeeId', f.employeeId]);
  if (f.pipelineStatus !== undefined) filters.push(['pipelineStatus', f.pipelineStatus]);
  if (f.changeAgentRequired !== undefined) filters.push(['changeAgentRequired', f.changeAgentRequired]);
  if (f.jotform !== undefined) filters.push(['jotform', f.jotform]);
  if (f.hasChangeAgentHistory !== undefined) filters.push(['hasChangeAgentHistory', f.hasChangeAgentHistory]);

  let rows: Array<{ id: string; d: Record<string, unknown> }>;
  if (filters.length === 0) {
    const snap = await col.orderBy('createdAt', 'desc').limit(limit).get();
    rows = snap.docs.map((doc) => ({ id: doc.id, d: doc.data() }));
  } else {
    const [primary, ...rest] = filters;
    // Fetch a wider window so in-memory secondary filtering doesn't starve the result.
    const fetchN = rest.length ? 400 : limit;
    const snap = await col.where(primary[0], '==', primary[1]).limit(fetchN).get();
    rows = snap.docs
      .map((doc) => ({ id: doc.id, d: doc.data() }))
      .filter(({ d }) => rest.every(([k, v]) => d[k] === v))
      .sort((a, b) => String(b.d.createdAt ?? '').localeCompare(String(a.d.createdAt ?? '')))
      .slice(0, limit);
  }
  return { count: rows.length, students: rows.map((r) => studentSummary(r.id, r.d)) };
}

export async function searchStudents(query: string, limit = 20) {
  const q = query.trim();
  if (!q) return { count: 0, students: [] };
  const lim = Math.min(Math.max(limit, 1), 50);
  const col = db().collection('students');
  const found = new Map<string, Record<string, unknown>>();

  // Exact phone match across the three phone fields.
  const phoneFields = ['phone', 'phone2', 'phone3'];
  const phoneSnaps = await Promise.all(phoneFields.map((pf) => col.where(pf, '==', q).limit(lim).get()));
  for (const snap of phoneSnaps) for (const doc of snap.docs) found.set(doc.id, doc.data());

  // Name prefix match (works for Arabic and Latin).
  try {
    const nameSnap = await col.orderBy('name').startAt(q).endAt(q + '').limit(lim).get();
    for (const doc of nameSnap.docs) found.set(doc.id, doc.data());
  } catch {
    /* name index/order unavailable — phone results still returned */
  }

  const students = Array.from(found.entries()).slice(0, lim).map(([id, d]) => studentSummary(id, d));
  return { count: students.length, students };
}

export async function getStudent(studentId: string) {
  const snap = await db().collection('students').doc(studentId).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  // Ensure the admin checklist state is always present (it's a map field written by
  // updateAdminChecklistItem; absent entirely when nothing is checked yet).
  return scrub({ id: snap.id, ...d, adminChecklistStatus: d.adminChecklistStatus ?? {} });
}

export async function getStudentChat(studentId: string, limit = 50) {
  const lim = Math.min(Math.max(limit, 1), 200);
  const snap = await db().collection('chats').doc(studentId).collection('messages').orderBy('timestamp', 'desc').limit(lim).get();
  const messages = snap.docs.map((d) => scrub({ id: d.id, ...d.data() })).reverse();
  return { count: messages.length, messages };
}

export async function listEmployees() {
  const snap = await db().collection('users').get();
  const users = snap.docs.map((d) => {
    const u = d.data();
    return scrub({ id: d.id, name: u.name ?? null, email: u.email ?? null, role: u.role ?? null, department: u.department ?? null, civilId: u.civilId ?? null });
  });
  return { count: users.length, users };
}

export async function listUniversities() {
  const snap = await db().collection('approved_universities').get();
  const universities = snap.docs.map((d) => scrub({ id: d.id, ...d.data() }));
  return { count: universities.length, universities };
}

export async function listInvoices(opts: { studentId?: string; status?: string; limit?: number } = {}) {
  const lim = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  let rows = (await db().collection('invoices').limit(400).get()).docs.map((d) => ({ id: d.id, d: d.data() }));
  if (opts.studentId) rows = rows.filter((r) => r.d.studentId === opts.studentId);
  if (opts.status) rows = rows.filter((r) => r.d.status === opts.status);
  rows = rows.sort((a, b) => String(b.d.createdAt ?? '').localeCompare(String(a.d.createdAt ?? ''))).slice(0, lim);
  return { count: rows.length, invoices: rows.map((r) => scrub({ id: r.id, ...r.d })) };
}

export async function listReminders(limit = 50) {
  const lim = Math.min(Math.max(limit, 1), 200);
  const snap = await db().collection('student_reminders').limit(lim).get();
  const reminders = snap.docs.map((d) => scrub({ id: d.id, ...d.data() }));
  return { count: reminders.length, reminders };
}

export async function listEvents() {
  const snap = await db().collection('upcoming_events').get();
  const events = snap.docs.map((d) => scrub({ id: d.id, ...d.data() }));
  return { count: events.length, events };
}

export async function listRequestTypes() {
  const snap = await db().collection('request_types').get();
  const requestTypes = snap.docs.map((d) => scrub({ id: d.id, ...d.data() }));
  return { count: requestTypes.length, requestTypes };
}
