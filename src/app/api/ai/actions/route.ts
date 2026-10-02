import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { listAiActions, undoAiAction } from '@/lib/ai/action-log';
import { collectDeadlines } from '@/lib/ai/deadlines';

export const runtime = 'nodejs';

/** The AI activity log, and Undo. Admins only. */
async function admin(req: NextRequest): Promise<{ id: string; name: string } | NextResponse> {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  const u = (await adminDb.collection('users').doc(uid).get()).data();
  if (u?.role !== 'admin') return NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  return { id: uid, name: u.name ?? 'Admin' };
}

export async function GET(req: NextRequest) {
  const who = await admin(req);
  if (who instanceof NextResponse) return who;
  const p = req.nextUrl.searchParams;
  if (p.get('view') === 'deadlines') {
    const all = await collectDeadlines();
    return NextResponse.json({ deadlines: all.filter((d) => d.warning || d.daysLeft <= 60) });
  }
  const actions = await listAiActions({
    limit: Number(p.get('limit') ?? 200),
    source: p.get('source') ?? undefined,
    studentId: p.get('studentId') ?? undefined,
  });
  return NextResponse.json({ actions });
}

export async function POST(req: NextRequest) {
  const who = await admin(req);
  if (who instanceof NextResponse) return who;
  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  if (typeof body.id !== 'string') return NextResponse.json({ error: '`id` is required.' }, { status: 400 });
  const r = await undoAiAction(body.id, who);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
