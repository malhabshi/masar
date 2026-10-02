import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { getBudgetSettings, getBudgetStatus, saveBudgetSettings } from '@/lib/ai/usage';

export const runtime = 'nodejs';

/** AI spending this month, and the budget. Admins only. */
async function isAdmin(req: NextRequest): Promise<NextResponse | null> {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  try {
    const uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
    const role = (await adminDb.collection('users').doc(uid).get()).data()?.role;
    return role === 'admin' ? null : NextResponse.json({ error: 'Admins only.' }, { status: 403 });
  } catch {
    return NextResponse.json({ error: 'Unauthorized: invalid or expired token.' }, { status: 401 });
  }
}

export async function GET(req: NextRequest) {
  const denied = await isAdmin(req);
  if (denied) return denied;
  const [status, settings] = await Promise.all([getBudgetStatus(), getBudgetSettings()]);
  return NextResponse.json({ status, settings });
}

export async function PATCH(req: NextRequest) {
  const denied = await isAdmin(req);
  if (denied) return denied;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON.' }, { status: 400 });
  }
  const settings = await saveBudgetSettings({
    monthlyBudgetUsd: typeof body.monthlyBudgetUsd === 'number' ? body.monthlyBudgetUsd : undefined,
    alertPercent: typeof body.alertPercent === 'number' ? body.alertPercent : undefined,
    prices: typeof body.prices === 'object' && body.prices ? (body.prices as any) : undefined,
  });
  return NextResponse.json({ settings, status: await getBudgetStatus() });
}
