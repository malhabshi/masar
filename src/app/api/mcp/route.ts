// Remote MCP server for masar tasks, connectable from the Claude app as a custom connector.
// The heavy handler (mcp-handler + MCP SDK) is imported dynamically at request time so the
// Next.js build never evaluates that import graph for this route (avoids build timeouts).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const { getMcpHandler } = await import('@/lib/mcp/handler');
  return getMcpHandler()(req);
}

export const GET = handle;
export const POST = handle;
