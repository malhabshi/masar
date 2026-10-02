// Scheduled sending of student-reminder WhatsApps.
//
// Every reminder fires four times — on creation, a day before, an hour before, and
// five minutes before — so this must run FREQUENTLY (every 5 minutes) for the last
// stage to be accurate. Sending is idempotent, so running it more often is harmless.
//
// Trigger it with:
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/reminder-notifications

import { NextRequest, NextResponse } from 'next/server';
import { processReminderStages } from '@/lib/actions';
import { runAllSiteWatches } from '@/lib/site-watch';
import { getDocumentReaderSettings, readPendingDocuments } from '@/lib/ai/documents';
import { isAiConfigured } from '@/lib/ai/config';
import { fulfilEmailRequests } from '@/lib/email/requests';
import { getIntakeSettings } from '@/lib/email/intake-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;

  // An unset secret must FAIL, not wave everyone through. Comparing against
  // `Bearer ${undefined}` would let anyone in who sends the literal string.
  if (!secret) {
    console.error('[cron/reminders] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json({ error: 'Scheduler is not configured.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const result = await processReminderStages();

  // Logged so a failing run is visible in Cloud Logging rather than silent.
  console.log(
    `[cron/reminders] sent=${result.sent} in ${Date.now() - startedAt}ms`,
    result.details.length ? result.details.join(' ') : '(nothing due)',
  );

  // The official-sites watch rides on this job so it needs no scheduler of its own. It
  // runs strictly AFTER the reminders are out, is throttled to once every 24 hours,
  // carries its own time budget, and can never fail this response.
  let siteWatch: unknown = null;
  try {
    siteWatch = await runAllSiteWatches();
    if ((siteWatch as { ran?: boolean })?.ran) console.log('[cron/site-watch]', JSON.stringify(siteWatch));
  } catch (e) {
    console.error('[cron/site-watch] failed:', e);
    siteWatch = { error: e instanceof Error ? e.message : String(e) };
  }

  // Read newly uploaded documents, a few per run. Every five minutes keeps up with uploads
  // without one run holding the job open; switched on from the AI Assistant page.
  let documents: unknown = null;
  try {
    if (isAiConfigured() && (await getDocumentReaderSettings()).autoRead) {
      documents = await readPendingDocuments({ limit: 8, concurrency: 4 });
    }
  } catch (e) {
    console.error('[cron/documents] failed:', e);
    documents = { error: e instanceof Error ? e.message : String(e) };
  }

  // Replies waiting on a document: draft the ones whose files are now on the profile.
  let emailDrafts: unknown = null;
  try {
    if ((await getIntakeSettings()).draftReplies) emailDrafts = await fulfilEmailRequests();
  } catch (e) {
    console.error('[cron/email-drafts] failed:', e);
    emailDrafts = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    siteWatch,
    documents,
    emailDrafts,
    success: true,
    messagesSent: result.sent,
    details: result.details,
    ranAt: new Date().toISOString(),
  });
}
