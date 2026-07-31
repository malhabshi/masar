// OAuth token endpoint. Exchanges an authorization code (with PKCE) or a refresh token
// for an access token stored in mcp_tokens (which the MCP route validates).
import { consumeAuthCode, consumeRefreshToken, issueAccessToken, verifyPkceS256 } from '@/lib/mcp/oauth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

function err(code: string, description: string, status = 400) {
  return Response.json({ error: code, error_description: description }, { status, headers: CORS });
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  if (!form) return err('invalid_request', 'Expected form-encoded body.');
  const grantType = String(form.get('grant_type') || '');
  const clientId = String(form.get('client_id') || '');

  if (grantType === 'authorization_code') {
    const code = String(form.get('code') || '');
    const redirectUri = String(form.get('redirect_uri') || '');
    const codeVerifier = String(form.get('code_verifier') || '');
    if (!code || !codeVerifier) return err('invalid_request', 'code and code_verifier are required.');

    const stored = await consumeAuthCode(code);
    if (!stored) return err('invalid_grant', 'Authorization code invalid or expired.');
    if (stored.clientId !== clientId) return err('invalid_grant', 'client_id mismatch.');
    if (stored.redirectUri !== redirectUri) return err('invalid_grant', 'redirect_uri mismatch.');
    if (!verifyPkceS256(codeVerifier, stored.codeChallenge)) return err('invalid_grant', 'PKCE verification failed.');

    const t = await issueAccessToken({ userId: stored.userId, userName: stored.userName, clientId, scope: stored.scope });
    return Response.json(
      { access_token: t.accessToken, token_type: 'Bearer', expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: stored.scope },
      { headers: CORS },
    );
  }

  if (grantType === 'refresh_token') {
    const refreshToken = String(form.get('refresh_token') || '');
    if (!refreshToken) return err('invalid_request', 'refresh_token is required.');
    const stored = await consumeRefreshToken(refreshToken, clientId);
    if (!stored) return err('invalid_grant', 'Refresh token invalid.');
    const t = await issueAccessToken({ userId: stored.userId, userName: stored.userName, clientId, scope: stored.scope });
    return Response.json(
      { access_token: t.accessToken, token_type: 'Bearer', expires_in: t.expiresIn, refresh_token: t.refreshToken, scope: stored.scope },
      { headers: CORS },
    );
  }

  return err('unsupported_grant_type', `Unsupported grant_type: ${grantType}`);
}
