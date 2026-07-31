// OAuth authorize endpoint. GET renders an owner-login page; POST verifies the owner
// secret, issues a PKCE-bound authorization code, and redirects back to the client.
import crypto from 'crypto';
import { getClient, issueAuthCode, OWNER } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function esc(s: string) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function page(params: Record<string, string>, error?: string) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'response_type']
    .map(k => `<input type="hidden" name="${k}" value="${esc(params[k] || '')}">`).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to masar</title>
  <style>body{font-family:system-ui;max-width:420px;margin:10vh auto;padding:0 20px}
  .card{border:1px solid #e5e7eb;border-radius:14px;padding:24px;box-shadow:0 4px 16px rgba(0,0,0,.06)}
  h1{font-size:20px;margin:0 0 4px}p{color:#6b7280;font-size:14px;margin:0 0 20px}
  input[type=password]{width:100%;padding:12px;border:1px solid #d1d5db;border-radius:10px;font-size:16px;box-sizing:border-box}
  button{width:100%;margin-top:14px;padding:12px;background:#4f46e5;color:#fff;border:0;border-radius:10px;font-size:16px;font-weight:600}
  .err{color:#dc2626;font-size:13px;margin-top:10px}</style></head>
  <body><div class="card"><h1>Connect Claude to masar</h1>
  <p>Enter your owner access secret to allow Claude to manage tasks.</p>
  <form method="POST">${hidden}
  <input type="password" name="owner_secret" placeholder="Owner secret" autofocus autocomplete="off" required>
  <button type="submit">Approve</button>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}</form></div></body></html>`;
}

function readParams(url: URL): Record<string, string> {
  const p: Record<string, string> = {};
  for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'response_type']) {
    p[k] = url.searchParams.get(k) || '';
  }
  return p;
}

async function validate(params: Record<string, string>): Promise<string | null> {
  if (params.response_type !== 'code') return 'Unsupported response_type (must be code).';
  if (!params.client_id) return 'Missing client_id.';
  if (!params.code_challenge || params.code_challenge_method !== 'S256') return 'PKCE S256 required.';
  const client = await getClient(params.client_id);
  if (!client) return 'Unknown client.';
  if (!params.redirect_uri || !client.redirectUris.includes(params.redirect_uri)) return 'redirect_uri not registered.';
  return null;
}

export async function GET(req: Request) {
  const params = readParams(new URL(req.url));
  const err = await validate(params);
  if (err) return new Response(err, { status: 400 });
  return new Response(page(params), { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export async function POST(req: Request) {
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const k of ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'response_type']) {
    params[k] = String(form.get(k) || '');
  }
  const err = await validate(params);
  if (err) return new Response(err, { status: 400 });

  const secret = String(form.get('owner_secret') || '');
  const ok = OWNER.secret.length > 0 &&
    secret.length === OWNER.secret.length &&
    crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(OWNER.secret));
  if (!ok) {
    return new Response(page(params, 'Incorrect secret.'), { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const code = await issueAuthCode({
    clientId: params.client_id, redirectUri: params.redirect_uri,
    codeChallenge: params.code_challenge, scope: params.scope || 'tasks',
  });
  const dest = new URL(params.redirect_uri);
  dest.searchParams.set('code', code);
  if (params.state) dest.searchParams.set('state', params.state);
  return Response.redirect(dest.toString(), 302);
}
