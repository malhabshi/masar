import { NextRequest, NextResponse } from 'next/server';
import { trustedRole } from '@/lib/auth/trusted-role';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { respondToStudentChat } from '@/lib/ai/chat-responder';
import { getResponderSettings, saveResponderSettings } from '@/lib/ai/chat-bot';
import { isAiConfigured } from '@/lib/ai/config';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Wakes the internal-chat responder for one student.
 *
 * Called by the chat UI right after a message is sent (fire-and-forget), so the sender
 * never waits on it. Any signed-in staff member may trigger it — the responder acts
 * under its own bot identity, not the caller's, so this grants no extra privilege.
 * A CRON_SECRET bearer token is also accepted for scheduled sweeps.
 */
export async function POST(req: NextRequest) {
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!token) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });

  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret && token === cronSecret);

  if (!isCron) {
    try {
      await adminAuth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
    }
  }

  let body: { studentId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  if (!studentId) return NextResponse.json({ error: '`studentId` is required.' }, { status: 400 });

  // Cheap pre-check so a disabled responder costs nothing.
  const settings = await getResponderSettings();
  if (!settings.enabled || !isAiConfigured()) {
    return NextResponse.json({ status: 'disabled' });
  }

  const outcome = await respondToStudentChat(studentId);
  return NextResponse.json(outcome);
}

/** Current responder settings, for the UI to decide whether to bother triggering. Staff only. */
export async function GET(req: NextRequest) {
  if (!adminAuth) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    await adminAuth.verifyIdToken(header.slice('Bearer '.length));
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  const settings = await getResponderSettings();
  return NextResponse.json({ ...settings, aiConfigured: isAiConfigured() });
}

/** Update responder settings. Admins only — this controls whether the AI speaks to staff. */
export async function PATCH(req: NextRequest) {
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }

  const userSnap = await adminDb.collection('users').doc(uid).get();
  const user = userSnap.exists ? ({ id: userSnap.id, ...userSnap.data() } as User) : null;
  if (!user || (await trustedRole(user.id)) !== 'admin') {
    return NextResponse.json({ error: 'Only admins can change responder settings.' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const saved = await saveResponderSettings({
    enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
    observeOnly: typeof body.observeOnly === 'boolean' ? body.observeOnly : undefined,
    allowTaskCreation:
      typeof body.allowTaskCreation === 'boolean' ? body.allowTaskCreation : undefined,
    mutedStudentIds: Array.isArray(body.mutedStudentIds)
      ? (body.mutedStudentIds as unknown[]).filter((v): v is string => typeof v === 'string')
      : undefined,
  });

  return NextResponse.json({ ...saved, aiConfigured: isAiConfigured() });
}
