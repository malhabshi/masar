import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { automateTask } from '@/lib/ai/task-automation';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Act on a request just created: add its schools, or draft its update email.
 * Called by the task dialog right after creation (not awaited); any signed-in staff
 * member may trigger it — it acts on that one task only, once, under the AI's name.
 */
export async function POST(req: NextRequest) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    await adminAuth.verifyIdToken(header.slice('Bearer '.length));
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
  return NextResponse.json(await automateTask(taskId));
}
