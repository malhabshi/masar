import { NextRequest, NextResponse } from 'next/server';
import { trustedRole } from '@/lib/auth/trusted-role';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { automateTask } from '@/lib/ai/task-automation';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Act on a request just created: add its schools, or draft its update email.
 * Called by the task dialog right after creation (not awaited). Only the person who
 * created the task, or an admin / department user, may trigger it — a signed-in student
 * or an unrelated employee holding a task id cannot. It acts on that one task, once.
 */
export async function POST(req: NextRequest) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  let body: { taskId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
  if (!taskId) return NextResponse.json({ error: '`taskId` is required.' }, { status: 400 });

  const [userSnap, taskSnap] = await Promise.all([
    adminDb.collection('users').doc(uid).get(),
    adminDb.collection('tasks').doc(taskId).get(),
  ]);
  const role = await trustedRole(uid);
  if (!userSnap.exists || !role || !['admin', 'adminplus', 'department', 'employee'].includes(role)) {
    return NextResponse.json({ error: 'Staff only.' }, { status: 403 });
  }
  if (!taskSnap.exists) return NextResponse.json({ error: 'Task not found.' }, { status: 404 });
  const isAuthor = taskSnap.data()?.authorId === uid;
  if (!isAuthor && !['admin', 'department'].includes(role)) {
    return NextResponse.json({ error: 'Only the person who created this request, or an admin, can run it.' }, { status: 403 });
  }

  // The caller gets only the outcome, not the drafted text or any student details.
  const result = await automateTask(taskId);
  return NextResponse.json({ status: result.status, kind: result.kind });
}
