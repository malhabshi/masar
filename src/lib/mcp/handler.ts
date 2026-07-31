// Builds the MCP request handler. Kept in a lib module (not the route) and created
// lazily so Next's build-time "page data collection" never imports this heavy graph
// (mcp-handler + MCP SDK) — that was causing a build timeout on /api/mcp.
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import { z } from 'zod';
import { adminDb } from '@/lib/firebase/admin';
import * as tasks from '@/lib/mcp/task-tools';
import type { TaskStatus } from '@/lib/types';

const statusEnum = z.enum(['new', 'in-progress', 'completed', 'denied']);

type Extra = { authInfo?: { extra?: { userId?: string; userName?: string } } };
function actorFrom(extra: Extra): { id: string; name: string } {
  const e = extra?.authInfo?.extra ?? {};
  return { id: e.userId || 'mcp', name: e.userName || 'MCP User' };
}
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

async function verifyToken(_req: Request, bearer?: string) {
  if (!bearer || !adminDb) return undefined;
  const snap = await adminDb.collection('mcp_tokens').doc(bearer).get();
  if (!snap.exists) return undefined;
  const d = snap.data() as { userId?: string; userName?: string; clientId?: string; scopes?: string[]; expiresAt?: string };
  if (d.expiresAt && Date.parse(d.expiresAt) < Date.now()) return undefined;
  return { token: bearer, clientId: d.clientId || 'claude', scopes: d.scopes || ['tasks'], extra: { userId: d.userId, userName: d.userName } };
}

let cached: ((req: Request) => Promise<Response>) | null = null;

export function getMcpHandler() {
  if (cached) return cached;

  const base = createMcpHandler((server) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = server as any;

    s.registerTool('list_tasks', {
      description: 'List tasks, newest first. Optionally filter by status (new, in-progress, completed, denied) or by recipient (assignee) id.',
      inputSchema: { status: statusEnum.optional(), recipientId: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    }, async ({ status, recipientId, limit }: { status?: TaskStatus; recipientId?: string; limit?: number }) =>
      text(JSON.stringify(await tasks.listTasks({ status, recipientId, limit }), null, 2)));

    s.registerTool('get_task', { description: 'Get a single task by id, including its replies.', inputSchema: { taskId: z.string() } },
      async ({ taskId }: { taskId: string }) => {
        const t = await tasks.getTask(taskId);
        return text(t ? JSON.stringify(t, null, 2) : 'Task not found.');
      });

    s.registerTool('create_task', {
      description: 'Create a new task. recipientId is the assignee user id (omit for everyone).',
      inputSchema: { content: z.string(), recipientId: z.string().optional(), studentId: z.string().optional(), studentName: z.string().optional(), taskType: z.string().optional() },
    }, async (args: { content: string; recipientId?: string; studentId?: string; studentName?: string; taskType?: string }, extra: Extra) => {
      const r = await tasks.createTask(args, actorFrom(extra));
      return text(`Created task ${r.id}.`);
    });

    s.registerTool('update_task_status', { description: 'Set a task status to new, in-progress, completed, or denied.', inputSchema: { taskId: z.string(), status: statusEnum } },
      async ({ taskId, status }: { taskId: string; status: TaskStatus }) => {
        const r = await tasks.updateTaskStatus(taskId, status);
        return text(`Task ${r.id} is now ${r.status}.`);
      });

    s.registerTool('reply_to_task', { description: 'Add a reply to a task (also moves it to in-progress).', inputSchema: { taskId: z.string(), content: z.string() } },
      async ({ taskId, content }: { taskId: string; content: string }, extra: Extra) => {
        const r = await tasks.replyToTask(taskId, content, actorFrom(extra));
        return text(`Replied to task ${r.id} (${r.replies} replies).`);
      });

    s.registerTool('assign_task', { description: 'Assign a task to a recipient (assignee) user id.', inputSchema: { taskId: z.string(), recipientId: z.string() } },
      async ({ taskId, recipientId }: { taskId: string; recipientId: string }) => {
        const r = await tasks.assignTask(taskId, recipientId);
        return text(`Task ${r.id} assigned to ${r.recipientId}.`);
      });

    s.registerTool('delete_task', { description: 'Permanently delete a task by id.', inputSchema: { taskId: z.string() } },
      async ({ taskId }: { taskId: string }) => {
        await tasks.deleteTask(taskId);
        return text(`Deleted task ${taskId}.`);
      });
  }, { serverInfo: { name: 'masar-tasks', version: '1.0.0' } });

  cached = withMcpAuth(base, verifyToken, { required: true });
  return cached;
}
