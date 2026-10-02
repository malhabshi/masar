import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import {
  documentReadingProgress,
  getDocumentReaderSettings,
  readPendingDocuments,
  saveDocumentReaderSettings,
} from '@/lib/ai/documents';
import { isAiConfigured } from '@/lib/ai/config';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Document reading: progress, settings, and "read the next N now".
 * Admins only — this decides which student files are sent to the AI provider.
 * POST also accepts the CRON_SECRET, for a scheduled sweep.
 */
async function authorise(req: NextRequest, allowCron = false): Promise<User | 'cron' | NextResponse> {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  if (allowCron && process.env.CRON_SECRET && token === process.env.CRON_SECRET) return 'cron';
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  const snap = await adminDb.collection('users').doc(uid).get();
  const user = snap.exists ? ({ id: snap.id, ...snap.data() } as User) : null;
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Only admins can manage document reading.' }, { status: 403 });
  }
  return user;
}

export async function GET(req: NextRequest) {
  const who = await authorise(req);
  if (who instanceof NextResponse) return who;
  const [settings, progress] = await Promise.all([getDocumentReaderSettings(), documentReadingProgress()]);
  return NextResponse.json({ settings, progress, aiConfigured: isAiConfigured() });
}

export async function PATCH(req: NextRequest) {
  const who = await authorise(req);
  if (who instanceof NextResponse) return who;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const settings = await saveDocumentReaderSettings({
    autoRead: typeof body.autoRead === 'boolean' ? body.autoRead : undefined,
    readPassports: typeof body.readPassports === 'boolean' ? body.readPassports : undefined,
  });
  return NextResponse.json({ settings });
}

export async function POST(req: NextRequest) {
  const who = await authorise(req, true);
  if (who instanceof NextResponse) return who;
  if (!isAiConfigured()) return NextResponse.json({ error: 'The AI is not configured.' }, { status: 400 });
  let body: { limit?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body: default batch */
  }
  const limit = typeof body.limit === 'number' ? body.limit : 20;
  const result = await readPendingDocuments({ limit });
  return NextResponse.json(result);
}
