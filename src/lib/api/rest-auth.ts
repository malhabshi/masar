// Bearer-token auth for the public read-only REST API (/api/v1). Tokens live in the
// same `mcp_tokens` collection the MCP uses, so one token can drive both surfaces.
// A viewer token has { readonly: true }. This module only READS tokens; it never
// mutates anything.
import { adminDb } from '@/lib/firebase/admin';

export type ApiToken = {
  token: string;
  userId?: string;
  userName?: string;
  role?: string;
  readonly: boolean;
  scopes?: string[];
};

export type ApiAuthResult =
  | { ok: true; token: ApiToken }
  | { ok: false; status: number; error: string };

function bearerFrom(req: Request): string | undefined {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (h) return h.replace(/^Bearer\s+/i, '').trim();
  // Fallback: allow ?token= for quick browser/testing use.
  try {
    const u = new URL(req.url);
    const t = u.searchParams.get('token');
    if (t) return t.trim();
  } catch { /* ignore */ }
  return undefined;
}

export async function authenticate(req: Request): Promise<ApiAuthResult> {
  if (!adminDb) return { ok: false, status: 503, error: 'Database not available.' };
  const bearer = bearerFrom(req);
  if (!bearer) return { ok: false, status: 401, error: 'Missing bearer token. Send "Authorization: Bearer <token>".' };

  const snap = await adminDb.collection('mcp_tokens').doc(bearer).get();
  if (!snap.exists) return { ok: false, status: 401, error: 'Invalid token.' };

  const d = snap.data() as { userId?: string; userName?: string; role?: string; readonly?: boolean; scopes?: string[]; expiresAt?: string };
  if (d.expiresAt && Date.parse(d.expiresAt) < Date.now()) return { ok: false, status: 401, error: 'Token expired.' };

  return {
    ok: true,
    token: { token: bearer, userId: d.userId, userName: d.userName, role: d.role, readonly: !!d.readonly, scopes: d.scopes },
  };
}
