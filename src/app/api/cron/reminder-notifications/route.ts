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
import { processPassportRenewals } from '@/lib/email/passport-renewal';
import { getIntakeSettings } from '@/lib/email/intake-settings';
import { syncSentMail } from '@/lib/email/memory';
import { followUpsIfDue } from '@/lib/email/followups';
import { automateRecentTasks } from '@/lib/ai/task-automation';
import { dueSlot, recordStart } from '@/lib/email/schedule';
import { buildTodayIfDue } from '@/lib/reports/employee-daily';
import { automaticAiAllowed } from '@/lib/ai/usage';
import { deadlineAlertsIfDue } from '@/lib/ai/deadlines';
import { ieltsWeeklyIfDue } from '@/lib/reports/ielts-weekly';

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

  // Every job below uses the AI. Once this month's budget is used up they all pause until
  // the month ends or the budget is raised; the reminders above never depend on it.
  const aiAllowed = await automaticAiAllowed();

  // The inbox check, Mon–Fri 10:00 / 13:00 / 15:00 Kuwait. Started as its own request so a
  // busy inbox never holds up this job; each round takes up to 10 emails, and rounds
  // repeat every five minutes until the slot is marked done. Started before the other AI
  // jobs, so a slow one of them cannot keep it from starting.
  let inbox: unknown = null;
  try {
    const slot = aiAllowed && (await getIntakeSettings()).scheduledIntake ? await dueSlot() : null;
    if (slot) {
      // The site's public address. Behind App Hosting, req.nextUrl.origin is the container's
      // own port with the visitor's https ("https://0.0.0.0:8080"), which nothing answers.
      const origin = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
      const started = fetch(new URL('/api/email/intake', origin), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ action: 'scheduled' }),
      })
        .then((res) => {
          if (!res.ok) throw new Error(`the inbox check answered ${res.status}`);
          return null;
        })
        .catch((e) => {
          const message = e instanceof Error ? e.message : String(e);
          console.error('[cron/inbox] failed:', message);
          return message;
        });
      // Long enough for the request to be on its way, or to fail; not waiting for the result.
      const failed = await Promise.race([started, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
      inbox = failed ? { slot, error: failed } : { started: slot };
      await recordStart(slot, failed).catch(() => undefined);
    }
  } catch (e) {
    console.error('[cron/inbox] failed:', e);
    inbox = { error: e instanceof Error ? e.message : String(e) };
  }

  // Read newly uploaded documents, a few per run. Every five minutes keeps up with uploads
  // without one run holding the job open; switched on from the AI Assistant page.
  let documents: unknown = null;
  try {
    if (aiAllowed && isAiConfigured() && (await getDocumentReaderSettings()).autoRead) {
      documents = await readPendingDocuments({ limit: 8, concurrency: 4 });
    }
  } catch (e) {
    console.error('[cron/documents] failed:', e);
    documents = { error: e instanceof Error ? e.message : String(e) };
  }

  // Replies waiting on a document: draft the ones whose files are now on the profile.
  let emailDrafts: unknown = null;
  try {
    if (aiAllowed && (await getIntakeSettings()).draftReplies) emailDrafts = await fulfilEmailRequests();
  } catch (e) {
    console.error('[cron/email-drafts] failed:', e);
    emailDrafts = { error: e instanceof Error ? e.message : String(e) };
  }

  // A renewed passport, drafted to the companies that need it (FGL school, else all active).
  let passportRenewals: unknown = null;
  try {
    if (aiAllowed && (await getIntakeSettings()).draftReplies) passportRenewals = await processPassportRenewals({ limit: 3 });
  } catch (e) {
    console.error('[cron/passport-renewals] failed:', e);
    passportRenewals = { error: e instanceof Error ? e.message : String(e) };
  }

  // The agency's sent replies, into each student's email memory.
  let sentMail: unknown = null;
  try {
    if (aiAllowed) sentMail = await syncSentMail();
  } catch (e) {
    console.error('[cron/sent-mail] failed:', e);
    sentMail = { error: e instanceof Error ? e.message : String(e) };
  }

  // Once a day: draft update requests for applications submitted 5+ days with no offer.
  let followUps: unknown = null;
  try {
    if (aiAllowed && (await getIntakeSettings()).followUps) followUps = await followUpsIfDue();
  } catch (e) {
    console.error('[cron/follow-ups] failed:', e);
    followUps = { error: e instanceof Error ? e.message : String(e) };
  }

  // Deadline reminders from the documents (no AI calls — reads what was already read).
  let deadlines: unknown = null;
  try {
    deadlines = await deadlineAlertsIfDue();
  } catch (e) {
    console.error('[cron/deadlines] failed:', e);
    deadlines = { error: e instanceof Error ? e.message : String(e) };
  }

  // Saturday from 20:00 Kuwait: the owner's Excel of Sunday's IELTS course students (no AI).
  let ieltsWeekly: unknown = null;
  try {
    ieltsWeekly = await ieltsWeeklyIfDue();
  } catch (e) {
    console.error('[cron/ielts-weekly] failed:', e);
    ieltsWeekly = { error: e instanceof Error ? e.message : String(e) };
  }

  // The day's employee report, built by itself after 22:00 Kuwait time.
  let dailyReport: unknown = null;
  try {
    if (aiAllowed) dailyReport = await buildTodayIfDue();
  } catch (e) {
    console.error('[cron/daily-report] failed:', e);
    dailyReport = { error: e instanceof Error ? e.message : String(e) };
  }

  // Requests no browser triggered (add schools / draft the update email).
  let taskAutomation: unknown = null;
  try {
    if (aiAllowed && isAiConfigured()) taskAutomation = await automateRecentTasks();
  } catch (e) {
    console.error('[cron/task-automation] failed:', e);
    taskAutomation = { error: e instanceof Error ? e.message : String(e) };
  }

  return NextResponse.json({
    siteWatch,
    documents,
    emailDrafts,
    sentMail,
    followUps,
    passportRenewals,
    taskAutomation,
    inbox,
    dailyReport,
    deadlines,
    ieltsWeekly,
    aiAllowed,
    success: true,
    messagesSent: result.sent,
    details: result.details,
    ranAt: new Date().toISOString(),
  });
}
