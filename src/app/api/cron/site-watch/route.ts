// Checks the watched official sites (Cultural Offices, MOHE) for changes. See src/lib/site-watch.ts.
//
// It already runs on its own: the reminder cron calls it every tick and it does real
// work only once every 24 hours. This route exists so a check can be forced by hand,
// and so it can be given its own Cloud Scheduler job later without touching the code.
//
//   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/site-watch?force=1

import { NextRequest, NextResponse } from 'next/server';
import { runAllSiteWatches } from '@/lib/site-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  // An unset secret must FAIL, not wave everyone through — see the reminders route.
  if (!secret) {
    console.error('[cron/site-watch] CRON_SECRET is not set — refusing to run.');
    return NextResponse.json({ error: 'Scheduler is not configured.' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const force = req.nextUrl.searchParams.get('force') === '1';
  const result = await runAllSiteWatches({ force });
  console.log('[cron/site-watch]', JSON.stringify(result));
  return NextResponse.json({ success: true, ...result, ranAt: new Date().toISOString() });
}
