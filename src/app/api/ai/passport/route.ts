import { NextRequest, NextResponse } from 'next/server';
import { trustedRole } from '@/lib/auth/trusted-role';
import { adminAuth, adminDb } from '@/lib/firebase/admin';
import { readPassport } from '@/lib/ai/passport';
import { getDocumentReaderSettings } from '@/lib/ai/documents';
import { isAiConfigured } from '@/lib/ai/config';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** A passport page is one image; anything bigger than this is not what the form expects. */
const MAX_BYTES = 10 * 1024 * 1024;
const STAFF_ROLES = ['admin', 'adminplus', 'employee', 'department'];

/**
 * Read a passport for the JotForm page and return its fields. Nothing is stored here —
 * the file is only saved when the form itself is submitted.
 *
 * Bound by the same "Include passports" switch as document reading on the AI page, so
 * there is one place that decides whether passport images go to the AI provider.
 */
export async function POST(req: NextRequest) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });

  const header = req.headers.get('authorization') ?? '';
  if (!header.startsWith('Bearer ')) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(header.slice('Bearer '.length))).uid;
  } catch {
    return NextResponse.json({ error: 'Your session expired. Reload the page and sign in again.' }, { status: 401 });
  }
  const role = await trustedRole(uid);
  if (!role || !STAFF_ROLES.includes(role)) return NextResponse.json({ error: 'Staff only.' }, { status: 403 });

  if (!isAiConfigured()) return NextResponse.json({ error: 'The AI is not set up yet.' }, { status: 400 });
  if (!(await getDocumentReaderSettings()).readPassports) {
    return NextResponse.json(
      { error: 'Passport reading is switched off. An admin can turn on "Include passports" on the AI Assistant page.' },
      { status: 403 },
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get('file');
    file = f instanceof File ? f : null;
  } catch {
    /* handled below */
  }
  if (!file) return NextResponse.json({ error: 'No passport file was sent.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'That file is too large to read.' }, { status: 400 });

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await readPassport(bytes, file.type || 'application/octet-stream');
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[ai/passport]', message);
    return NextResponse.json({ error: message.startsWith('Use a photo') ? message : 'The passport could not be read. Please type the details.' }, { status: 422 });
  }
}
