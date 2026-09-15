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

  return NextResponse.json({
    success: true,
    messagesSent: result.sent,
    details: result.details,
    ranAt: new Date().toISOString(),
  });
}
