import { NextRequest, NextResponse } from 'next/server';
import type Anthropic from '@anthropic-ai/sdk';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { runAgent } from '@/lib/ai/agent';
import { AI_ALLOWED_ROLES, AI_MODEL, isAiConfigured, AI_NOT_CONFIGURED_MESSAGE } from '@/lib/ai/config';
import { getEmailConfigStatus } from '@/lib/email';
import type { Actor } from '@/lib/mcp/dispatch';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';
// Agent runs make several sequential model calls; the default serverless window is tight.
export const maxDuration = 300;

/** Rough ceiling on conversation size sent per request, to bound cost and payload. */
const MAX_MESSAGES = 60;

type AuthResult = { ok: true; actor: Actor } | { ok: false; status: number; error: string };

async function authenticate(req: NextRequest): Promise<AuthResult> {
  if (!adminAuth || !adminDb) {
    return { ok: false, status: 500, error: 'Server configuration error: Firebase Admin is not initialized.' };
  }

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Unauthorized: no token provided.' };
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(header.slice('Bearer '.length));
    uid = decoded.uid;
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized: invalid or expired token.' };
  }

  const snap = await adminDb.collection('users').doc(uid).get();
  if (!snap.exists) return { ok: false, status: 403, error: 'No masar user record for this account.' };

  const user = { id: snap.id, ...snap.data() } as User;
  if (!AI_ALLOWED_ROLES.includes(user.role as (typeof AI_ALLOWED_ROLES)[number])) {
    return {
      ok: false,
      status: 403,
      error: `The AI assistant is limited to: ${AI_ALLOWED_ROLES.join(', ')}.`,
    };
  }

  return {
    ok: true,
    actor: { id: user.id, name: user.name, civilId: user.civilId, role: user.role },
  };
}

/** Status probe for the UI — reports what is and is not wired up, without calling the model. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({
    aiConfigured: isAiConfigured(),
    model: AI_MODEL,
    email: getEmailConfigStatus(),
    user: { id: auth.actor.id, name: auth.actor.name, role: auth.actor.role },
    ...(isAiConfigured() ? {} : { setupHint: AI_NOT_CONFIGURED_MESSAGE }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: AI_NOT_CONFIGURED_MESSAGE }, { status: 503 });
  }

  let body: { messages?: unknown; allowWrites?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: '`messages` must be a non-empty array.' }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json(
      { error: `Conversation too long (${messages.length} messages, max ${MAX_MESSAGES}). Start a new chat.` },
      { status: 400 },
    );
  }
  if (messages[0]?.role !== 'user') {
    return NextResponse.json({ error: 'The first message must be from the user.' }, { status: 400 });
  }

  // allowWrites is opt-in per request: absent or non-true means read-only.
  const allowWrites = body.allowWrites === true;

  try {
    const result = await runAgent({
      messages: messages as Anthropic.MessageParam[],
      actor: auth.actor,
      allowWrites,
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error('[ai/chat] Agent run failed:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'The assistant failed unexpectedly.' },
      { status: 500 },
    );
  }
}
