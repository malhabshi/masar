import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { addTeamNote, getTeamNotes, removeTeamNote, WORK_GUIDE_TOPICS } from '@/lib/ai/knowledge';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * The team's notes for the AI — the agency's own rules, in its own words. Read by the
 * assistant and the chat responder through get_work_guide. Admins only: a note changes
 * what the AI tells every member of staff.
 */
async function requireAdmin(req: NextRequest): Promise<User | NextResponse> {
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  const snap = await adminDb.collection('users').doc(uid).get();
  const user = snap.exists ? ({ id: snap.id, ...snap.data() } as User) : null;
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can manage the AI notes.' }, { status: 403 });
  }
  return user;
}

export async function GET(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ notes: await getTeamNotes(), topics: [...WORK_GUIDE_TOPICS, 'general'] });
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;
  let body: { topic?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return NextResponse.json({ error: 'Write the note first.' }, { status: 400 });
  const topic = typeof body.topic === 'string' && [...WORK_GUIDE_TOPICS, 'general'].includes(body.topic)
    ? body.topic
    : 'general';
  const note = await addTeamNote({ topic, text, addedBy: user.name });
  return NextResponse.json({ note, notes: await getTeamNotes() });
}

export async function DELETE(req: NextRequest) {
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ error: '`id` is required.' }, { status: 400 });
  const removed = await removeTeamNote(id);
  return NextResponse.json({ removed, notes: await getTeamNotes() });
}
