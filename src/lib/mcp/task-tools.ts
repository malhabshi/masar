// Task operations exposed over MCP. These run server-side with the Firebase admin
// SDK and act on behalf of the authenticated MCP user (actorId/actorName come from
// the validated OAuth token).
//
// IMPORTANT — the `tasks` collection mixes THREE things: genuine request tasks
// (category === 'request', the ones the /tasks page shows) and a huge activity-feed of
// notifications (category 'system'/'update', ~18k+ docs). Discovery tools MUST filter to
// category === 'request' and mirror the UI's exclusions, or absence carries no meaning.
import { adminDb } from '@/lib/firebase/admin';
import type { Task, TaskStatus } from '@/lib/types';

const TASK_STATUSES: TaskStatus[] = ['new', 'in-progress', 'completed', 'denied'];
const REQUEST_CATEGORY = 'request';
// Cap on docs read per discovery call. Recipient-scoped queries are far below this
// (largest observed ≈ 600); only broad no-recipient pulls can hit it -> capped:true.
const READ_CAP = 5000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// Mirrors the /tasks page (task-manager.tsx) exclusions so MCP output reconciles with the UI.
function isExcludedFromTaskPage(t: Any): boolean {
  const it = String(t.taskType || '').toLowerCase();
  if (t.data?.examType === 'ielts_course' || it === 'ielts course') return true;
  if (t.data?.examType === 'unified_exam' || it === 'unified exam') return true;
  if (t.taskType === 'Transfer Request' || t.taskType === 'Deletion Request') return true;
  const c = String(t.content || '').toLowerCase();
  if (c.includes('transfer request') || c.includes('deletion request')) return true;
  return false;
}

function targetsOf(t: Any): string[] {
  return t.recipientIds && t.recipientIds.length ? t.recipientIds : t.recipientId ? [t.recipientId] : [];
}

// Convert any Firestore Timestamp (admin instance or {_seconds,_nanoseconds}) to ISO 8601, deeply.
function deepIso(v: Any): Any {
  if (v == null) return v;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (typeof v === 'object' && typeof v._seconds === 'number' && typeof v._nanoseconds === 'number') return new Date(v._seconds * 1000).toISOString();
  if (Array.isArray(v)) return v.map(deepIso);
  if (typeof v === 'object') { const o: Any = {}; for (const k of Object.keys(v)) o[k] = deepIso(v[k]); return o; }
  return v;
}

// Stable descending sort key: createdAt then id (tiebreak) — also the cursor value.
const sortKey = (t: Any) => `${t.createdAt || ''}|${t.id}`;
const encodeCursor = (s: string) => Buffer.from(s).toString('base64url');
const decodeCursor = (s: string) => Buffer.from(s, 'base64url').toString();

async function resolveNames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.filter((id) => id && !id.startsWith('dept:') && !['all', 'admins'].includes(id)))];
  if (!uniq.length) return {};
  const docs = await db().getAll(...uniq.map((id) => db().collection('users').doc(id)));
  const map: Record<string, string> = {};
  docs.forEach((d) => { if (d.exists) map[d.id] = (d.data() as Any).name || d.id; });
  return map;
}

function summarize(t: Any, nameMap: Record<string, string>) {
  const recips = targetsOf(t);
  return {
    id: t.id,
    content: t.content ?? '',
    status: t.status ?? 'new',
    taskType: t.taskType ?? null,
    studentId: t.studentId ?? null,
    studentName: t.studentName ?? null,
    studentPhone: t.studentPhone ?? null,
    recipientId: t.recipientId ?? null,
    recipientIds: recips,
    recipientNames: recips.map((r) => nameMap[r] ?? r),
    authorId: t.authorId ?? null,
    authorName: t.authorName ?? nameMap[t.authorId] ?? null,
    isPrioritized: !!t.isPrioritized,
    createdAt: t.createdAt ?? null,
    replies: (t.replies || []).length,
    data: t.data ? deepIso(t.data) : null,
  };
}

export type ListTasksOpts = { status?: TaskStatus; recipientId?: string; taskType?: string; cursor?: string; limit?: number };

// Gather candidate docs using the single most-selective indexable filter. Recipient
// membership is addressed two ways in the data — the `recipientIds` array (new/most docs)
// and a legacy `recipientId` string with empty array — so a recipient query UNIONs both,
// matching the UI's `targetsOf = recipientIds || [recipientId]`. Each query uses a single
// field, so no composite indexes are needed.
async function fetchCandidates(opts: ListTasksOpts): Promise<{ docs: Any[]; capped: boolean }> {
  const seen = new Map<string, Any>();
  let capped = false;
  const collect = async (q: FirebaseFirestore.Query) => {
    const snap = await q.limit(READ_CAP + 1).get();
    if (snap.size > READ_CAP) capped = true;
    snap.docs.slice(0, READ_CAP).forEach((d) => seen.set(d.id, { id: d.id, ...(d.data() as Any) }));
  };
  const col = () => db().collection('tasks') as FirebaseFirestore.Query;
  if (opts.recipientId) {
    await collect(col().where('recipientIds', 'array-contains', opts.recipientId));
    await collect(col().where('recipientId', '==', opts.recipientId));
  } else if (opts.status) {
    await collect(col().where('status', '==', opts.status));
  } else {
    await collect(col().where('category', '==', REQUEST_CATEGORY));
  }
  return { docs: [...seen.values()], capped };
}

// Fetch + fully filter (category==request, status, recipient membership, UI exclusions,
// taskType) and sort desc. Returns the complete matching set (bounded by READ_CAP) so
// callers can paginate/count exactly.
async function fetchFiltered(opts: ListTasksOpts): Promise<{ rows: Any[]; capped: boolean }> {
  const { docs, capped } = await fetchCandidates(opts);
  let rows: Any[] = docs;

  rows = rows.filter((t) => t.category === REQUEST_CATEGORY);
  if (opts.status) rows = rows.filter((t) => t.status === opts.status);
  if (opts.recipientId) rows = rows.filter((t) => targetsOf(t).includes(opts.recipientId!));
  rows = rows.filter((t) => !isExcludedFromTaskPage(t));
  if (opts.taskType) {
    const want = opts.taskType.trim().toLowerCase(); // tolerate stored trailing spaces ("New IELTS/TOFEL Exam ")
    rows = rows.filter((t) => String(t.taskType || '').trim().toLowerCase() === want);
  }
  rows.sort((a, b) => sortKey(b).localeCompare(sortKey(a))); // newest first
  return { rows, capped };
}

export async function listTasks(opts: ListTasksOpts) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const { rows, capped } = await fetchFiltered(opts);
  const totalCount = rows.length;

  let start = 0;
  if (opts.cursor) {
    const key = decodeCursor(opts.cursor);
    start = rows.findIndex((r) => sortKey(r).localeCompare(key) < 0);
    if (start < 0) start = rows.length;
  }
  const page = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;

  const nameMap = await resolveNames(page.flatMap((t) => targetsOf(t)).concat(page.map((t) => t.authorId)));
  return {
    totalCount,
    count: page.length,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor(sortKey(page[page.length - 1])) : null,
    ...(capped ? { capped: true } : {}),
    tasks: page.map((t) => summarize(t, nameMap)),
  };
}

export async function countTasks(opts: ListTasksOpts) {
  const { rows, capped } = await fetchFiltered(opts);
  return { count: rows.length, ...(capped ? { capped: true } : {}) };
}

export async function getTasksForStudent(studentId: string) {
  const snap = await db().collection('tasks').where('studentId', '==', studentId).limit(1000).get();
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Any) }))
    .filter((t) => t.category === REQUEST_CATEGORY && !isExcludedFromTaskPage(t))
    .sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const nameMap = await resolveNames(rows.flatMap((t) => targetsOf(t)).concat(rows.map((t) => t.authorId)));
  return { count: rows.length, tasks: rows.map((t) => summarize(t, nameMap)) };
}

// Separate tool for the activity feed (category !== 'request'). Deliberately NOT merged
// with tasks — kept so an agent can inspect notifications without polluting task discovery.
export async function listNotifications(opts: { recipientId?: string; cursor?: string; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const seen = new Map<string, Any>();
  const collect = async (q: FirebaseFirestore.Query) => {
    (await q.limit(READ_CAP).get()).docs.forEach((d) => seen.set(d.id, { id: d.id, ...(d.data() as Any) }));
  };
  const col = () => db().collection('tasks') as FirebaseFirestore.Query;
  if (opts.recipientId) {
    await collect(col().where('recipientIds', 'array-contains', opts.recipientId));
    await collect(col().where('recipientId', '==', opts.recipientId));
  } else {
    await collect(col().where('category', 'in', ['system', 'update']));
  }
  let rows: Any[] = [...seen.values()].filter((t) => t.category !== REQUEST_CATEGORY);
  if (opts.recipientId) rows = rows.filter((t) => targetsOf(t).includes(opts.recipientId!));
  rows.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
  const totalCount = rows.length;

  let start = 0;
  if (opts.cursor) {
    const key = decodeCursor(opts.cursor);
    start = rows.findIndex((r) => sortKey(r).localeCompare(key) < 0);
    if (start < 0) start = rows.length;
  }
  const page = rows.slice(start, start + limit);
  const hasMore = start + limit < rows.length;
  return {
    totalCount,
    count: page.length,
    hasMore,
    nextCursor: hasMore && page.length ? encodeCursor(sortKey(page[page.length - 1])) : null,
    notifications: page.map((t) => ({ id: t.id, content: t.content ?? '', category: t.category ?? null, studentId: t.studentId ?? null, studentName: t.studentName ?? null, createdAt: t.createdAt ?? null })),
  };
}

export async function getTask(taskId: string) {
  const doc = await db().collection('tasks').doc(taskId).get();
  if (!doc.exists) return null;
  const t = { id: doc.id, ...(doc.data() as Any) };
  const nameMap = await resolveNames(targetsOf(t).concat([t.authorId]));
  return { ...summarize(t, nameMap), replies: deepIso(t.replies || []) };
}

export async function createTask(input: {
  content: string; recipientId?: string; studentId?: string; studentName?: string; taskType?: string;
}, actor: { id: string; name: string }) {
  const now = new Date().toISOString();
  const ref = await db().collection('tasks').add({
    authorId: actor.id,
    authorName: actor.name,
    createdBy: actor.id,
    recipientId: input.recipientId || 'all',
    recipientIds: input.recipientId ? [input.recipientId] : ['all'],
    content: input.content,
    status: 'new',
    category: 'request',
    ...(input.studentId ? { studentId: input.studentId } : {}),
    ...(input.studentName ? { studentName: input.studentName } : {}),
    ...(input.taskType ? { taskType: input.taskType } : {}),
    createdAt: now,
    replies: [],
  });
  return { id: ref.id };
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  if (!TASK_STATUSES.includes(status)) throw new Error(`Invalid status. Use one of: ${TASK_STATUSES.join(', ')}`);
  const ref = db().collection('tasks').doc(taskId);
  if (!(await ref.get()).exists) throw new Error('Task not found');
  await ref.update({ status });
  return { id: taskId, status };
}

export async function replyToTask(taskId: string, content: string, actor: { id: string; name: string }) {
  const ref = db().collection('tasks').doc(taskId);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('Task not found');
  const reply = { id: `reply-${Date.now()}`, authorId: actor.id, authorName: actor.name, content, createdAt: new Date().toISOString() };
  const replies = [...((doc.data() as Task).replies || []), reply];
  await ref.update({ replies, status: 'in-progress' });
  return { id: taskId, replies: replies.length };
}

export async function assignTask(taskId: string, recipientId: string) {
  const ref = db().collection('tasks').doc(taskId);
  if (!(await ref.get()).exists) throw new Error('Task not found');
  await ref.update({ recipientId, recipientIds: [recipientId] });
  return { id: taskId, recipientId };
}

export async function deleteTask(taskId: string) {
  const ref = db().collection('tasks').doc(taskId);
  if (!(await ref.get()).exists) throw new Error('Task not found');
  await ref.delete();
  return { id: taskId, deleted: true };
}
