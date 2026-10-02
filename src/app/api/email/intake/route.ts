import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import {
  dismissQueuedItem,
  INTAKE_QUEUE_COLLECTION,
  resolveQueuedItem,
  runEmailIntake,
} from '@/lib/email/intake';
import { isInboxConfigured, verifyInboxConnection } from '@/lib/email/inbox';
import { getIntakeSettings, saveIntakeSettings } from '@/lib/email/intake-settings';
import { fulfilEmailRequests, listEmailRequests } from '@/lib/email/requests';
import { followUpSubmittedApplications } from '@/lib/email/followups';
import {
  learnCompanyPlaybook,
  listCompanyProfiles,
  removeCompany,
  saveCompany,
  saveCompanyNotes,
} from '@/lib/email/companies';
import type { User } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 300;

type Auth = { ok: true; user: User } | { ok: false; status: number; error: string };

/** Admins only — this files documents onto student profiles. */
async function authenticate(req: NextRequest): Promise<Auth> {
  if (!adminAuth || !adminDb) {
    return { ok: false, status: 500, error: 'Server configuration error.' };
  }
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return { ok: false, status: 401, error: 'Unauthorized.' };

  const token = header.slice('Bearer '.length);
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) {
    return { ok: true, user: { id: 'cron', name: 'Scheduled job', role: 'admin' } as User };
  }

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized: invalid or expired token.' };
  }

  const snap = await adminDb.collection('users').doc(uid).get();
  const user = snap.exists ? ({ id: snap.id, ...snap.data() } as User) : null;
  if (!user || user.role !== 'admin') {
    return { ok: false, status: 403, error: 'Email intake is limited to admins.' };
  }
  return { ok: true, user };
}

/** Status + the pending review queue. */
export async function GET(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const connection = isInboxConfigured() ? await verifyInboxConnection() : { ok: false, error: 'Not configured.' };

  const snap = await adminDb!
    .collection(INTAKE_QUEUE_COLLECTION)
    .where('status', '==', 'pending')
    .get();

  const queue = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String((b as any).createdAt).localeCompare(String((a as any).createdAt)));

  return NextResponse.json({
    configured: isInboxConfigured(),
    connection,
    settings: await getIntakeSettings(),
    pendingCount: queue.length,
    queue,
    requests: await listEmailRequests(40).catch(() => []),
    companies: await listCompanyProfiles().catch(() => []),
  });
}

/** Run an intake pass, or act on a queued item. */
export async function POST(req: NextRequest) {
  const auth = await authenticate(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: {
    action?: string;
    queueItemId?: string;
    studentId?: string;
    reason?: string;
    limit?: number;
    restrictToStudentId?: string | null;
    restrictToStudentName?: string | null;
    aiRenameDocuments?: boolean;
    postToChat?: boolean;
    draftReplies?: boolean;
    autoApplicationStatus?: boolean;
    companyId?: string;
    teamNotes?: string;
    companyName?: string;
    domains?: string;
    followUps?: boolean;
    reactToNotices?: boolean;
    taskAddSchools?: boolean;
    taskUpdateDrafts?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  switch (body.action ?? 'run') {
    case 'run': {
      const result = await runEmailIntake({ limit: body.limit });
      return NextResponse.json(result);
    }
    case 'followUps': {
      const result = await followUpSubmittedApplications();
      return NextResponse.json({ success: true, ...result });
    }
    case 'learnCompany': {
      if (!body.companyId) return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
      try {
        const learned = await learnCompanyPlaybook(body.companyId);
        return NextResponse.json({ success: true, received: learned.received, sent: learned.sent });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    }
    case 'saveCompany': {
      try {
        const saved = await saveCompany({ id: body.companyId, name: body.companyName ?? '', domains: body.domains ?? '' });
        return NextResponse.json({ success: true, company: saved });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    }
    case 'removeCompany': {
      if (!body.companyId) return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
      try {
        await removeCompany(body.companyId);
        return NextResponse.json({ success: true });
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
    }
    case 'companyNotes': {
      if (!body.companyId) return NextResponse.json({ error: 'companyId is required.' }, { status: 400 });
      await saveCompanyNotes(body.companyId, body.teamNotes ?? '');
      return NextResponse.json({ success: true });
    }
    case 'drafts': {
      // Check now for requests whose documents have arrived, instead of waiting for the next run.
      const result = await fulfilEmailRequests();
      return NextResponse.json(result);
    }
    case 'resolve': {
      if (!body.queueItemId || !body.studentId) {
        return NextResponse.json({ error: 'queueItemId and studentId are required.' }, { status: 400 });
      }
      const result = await resolveQueuedItem(body.queueItemId, body.studentId, auth.user.id);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }
    case 'dismiss': {
      if (!body.queueItemId) {
        return NextResponse.json({ error: 'queueItemId is required.' }, { status: 400 });
      }
      const result = await dismissQueuedItem(body.queueItemId, auth.user.id, body.reason);
      return NextResponse.json(result);
    }
    case 'settings': {
      const saved = await saveIntakeSettings({
        restrictToStudentId: body.restrictToStudentId,
        restrictToStudentName: body.restrictToStudentName,
        aiRenameDocuments: body.aiRenameDocuments,
        postToChat: body.postToChat,
        draftReplies: body.draftReplies,
        autoApplicationStatus: body.autoApplicationStatus,
        followUps: body.followUps,
        reactToNotices: body.reactToNotices,
        taskAddSchools: body.taskAddSchools,
        taskUpdateDrafts: body.taskUpdateDrafts,
      });
      return NextResponse.json({ success: true, settings: saved });
    }
    default:
      return NextResponse.json({ error: `Unknown action "${body.action}".` }, { status: 400 });
  }
}
