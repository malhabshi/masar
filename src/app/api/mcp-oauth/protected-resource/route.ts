// RFC 9728 Protected Resource Metadata — tells Claude which authorization server
// protects the /api/mcp resource. Origin is detected from proxy headers (App Hosting).
import { getPublicOrigin } from 'mcp-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, MCP-Protocol-Version',
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request) {
  const origin = getPublicOrigin(req);
  return Response.json(
    {
      resource: `${origin}/api/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['tasks'],
    },
    { headers: CORS },
  );
}
