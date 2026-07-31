// Task operations exposed over MCP. These run server-side with the Firebase admin
// SDK and act on behalf of the authenticated MCP user (actorId/actorName come from
// the validated OAuth token).
import { adminDb } from '@/lib/firebase/admin';
import type { Task, TaskStatus } from '@/lib/types';

const TASK_STATUSES: TaskStatus[] = ['new', 'in-progress', 'completed', 'denied'];

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

function summarize(id: string, t: Partial<Task>) {
  return {
    id,
    content: t.content ?? '',
    status: t.status ?? 'new',
    studentName: t.studentName ?? null,
    studentId: t.studentId ?? null,
    taskType: t.taskType ?? null,
    recipientId: t.recipientId ?? null,
    createdAt: t.createdAt ?? null,
    replies: (t.replies || []).length,
  };
}

export async function listTasks(opts: { status?: TaskStatus; recipientId?: string; limit?: number }) {
  let q = db().collection('tasks') as FirebaseFirestore.Query;
  if (opts.status) q = q.where('status', '==', opts.status);
  if (opts.recipientId) q = q.where('recipientId', '==', opts.recipientId);
  const snap = await q.limit(Math.min(opts.limit ?? 25, 100)).get();
  const rows = snap.docs.map(d => summarize(d.id, d.data() as Task));
  // newest first
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows;
}

export async function getTask(taskId: string) {
  const doc = await db().collection('tasks').doc(taskId).get();
  if (!doc.exists) return null;
  const t = doc.data() as Task;
  return { ...summarize(doc.id, t), replies: t.replies || [], data: t.data ?? null };
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
    recipientIds: input.recipientId ? [input.recipientId] : [],
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
