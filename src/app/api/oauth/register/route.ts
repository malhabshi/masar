// RFC 7591 Dynamic Client Registration — Claude registers itself and gets a client_id.
import { registerClient } from '@/lib/mcp/oauth';

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

export async function POST(req: Request) {
  let body: { redirect_uris?: string[]; client_name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_request', error_description: 'Body must be JSON.' }, { status: 400, headers: CORS });
  }
  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter(u => typeof u === 'string') : [];
  if (redirectUris.length === 0) {
    return Response.json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris is required.' }, { status: 400, headers: CORS });
  }
  const clientId = await registerClient(redirectUris, body.client_name);
  return Response.json(
    {
      client_id: clientId,
      redirect_uris: redirectUris,
      client_name: body.client_name || 'MCP Client',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    },
    { status: 201, headers: CORS },
  );
}
