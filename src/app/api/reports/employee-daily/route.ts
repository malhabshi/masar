import { NextRequest, NextResponse } from 'next/server';
import { trustedRole } from '@/lib/auth/trusted-role';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { buildDailyReport, getDailyReport, kuwaitToday } from '@/lib/reports/employee-daily';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * The daily employee report for one day. Admins only — it is an assessment of staff.
 * GET ?date=YYYY-MM-DD returns the kept report (building it the first time);
 * add &refresh=1 to rebuild it.
 */
export async function GET(req: NextRequest) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
  if ((await trustedRole(uid)) !== 'admin') return NextResponse.json({ error: 'Only admins can see staff reports.' }, { status: 403 });

  const date = req.nextUrl.searchParams.get('date') ?? kuwaitToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD.' }, { status: 400 });
  if (date > kuwaitToday()) return NextResponse.json({ error: 'That day has not happened yet.' }, { status: 400 });

  const refresh = req.nextUrl.searchParams.get('refresh') === '1';
  const report = (!refresh && (await getDailyReport(date))) || (await buildDailyReport(date));
  return NextResponse.json(report);
}
