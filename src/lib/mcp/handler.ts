// Builds the MCP request handler. Kept in a lib module (not the route) and created
// lazily so Next's build-time "page data collection" never imports this heavy graph
// (mcp-handler + MCP SDK) — that was causing a build timeout on /api/mcp.
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
// The MCP SDK bundled in mcp-handler requires Zod v4 schemas for tool inputSchema.
// Use the aliased v4 here only; the rest of the app stays on Zod v3.
import { z } from 'zod-v4';
import { adminDb } from '@/lib/firebase/admin';
import * as tasks from '@/lib/mcp/task-tools';
import * as q from '@/lib/mcp/query-tools';
import { listCapabilities, runAction, type Actor } from '@/lib/mcp/dispatch';
import type { TaskStatus } from '@/lib/types';

const statusEnum = z.enum(['new', 'in-progress', 'completed', 'denied']);

type Extra = { authInfo?: { extra?: { userId?: string; userName?: string; civilId?: string; role?: string } } };
function actorFrom(extra: Extra): Actor {
  const e = extra?.authInfo?.extra ?? {};
  return { id: e.userId || 'mcp', name: e.userName || 'MCP User', civilId: e.civilId, role: e.role || 'admin' };
}
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

async function verifyToken(_req: Request, bearer?: string) {
  if (!bearer || !adminDb) return undefined;
  const snap = await adminDb.collection('mcp_tokens').doc(bearer).get();
  if (!snap.exists) return undefined;
  const d = snap.data() as { userId?: string; userName?: string; civilId?: string; role?: string; clientId?: string; scopes?: string[]; expiresAt?: string };
  if (d.expiresAt && Date.parse(d.expiresAt) < Date.now()) return undefined;
  return { token: bearer, clientId: d.clientId || 'claude', scopes: d.scopes || ['tasks'], extra: { userId: d.userId, userName: d.userName, civilId: d.civilId, role: d.role } };
}

let cached: ((req: Request) => Promise<Response>) | null = null;

export function getMcpHandler() {
  if (cached) return cached;

  const base = createMcpHandler((server) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = server as any;

    // ---------------------------------------------------------------- Tasks
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

    // ---------------------------------------------------------- Read layer
    s.registerTool('list_students', {
      description: 'List students (newest first). Optional filters: employeeId, pipelineStatus, changeAgentRequired, jotform, hasChangeAgentHistory. Returns compact summaries.',
      inputSchema: {
        employeeId: z.string().optional(), pipelineStatus: z.string().optional(),
        changeAgentRequired: z.boolean().optional(), jotform: z.boolean().optional(),
        hasChangeAgentHistory: z.boolean().optional(), limit: z.number().int().min(1).max(100).optional(),
      },
    }, async (f: q.StudentFilters) => json(await q.listStudents(f)));

    s.registerTool('search_students', {
      description: 'Find students by exact phone number or by name prefix (Arabic or Latin). Returns compact summaries with their id (use it with get_student or run_action).',
      inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
    }, async ({ query, limit }: { query: string; limit?: number }) => json(await q.searchStudents(query, limit)));

    s.registerTool('get_student', {
      description: 'Get one full student profile by id (applications, notes, documents, accepted info, checklist, everything).',
      inputSchema: { studentId: z.string() },
    }, async ({ studentId }: { studentId: string }) => {
      const st = await q.getStudent(studentId);
      return st ? json(st) : text('Student not found.');
    });

    s.registerTool('get_student_chat', {
      description: 'Get the internal chat messages for a student (oldest to newest).',
      inputSchema: { studentId: z.string(), limit: z.number().int().min(1).max(200).optional() },
    }, async ({ studentId, limit }: { studentId: string; limit?: number }) => json(await q.getStudentChat(studentId, limit)));

    s.registerTool('list_employees', { description: 'List all staff/users (id, name, email, role, department, civilId). Use ids as recipient/assignee/employee targets.', inputSchema: {} },
      async () => json(await q.listEmployees()));

    s.registerTool('list_universities', { description: 'List approved universities.', inputSchema: {} }, async () => json(await q.listUniversities()));

    s.registerTool('list_invoices', {
      description: 'List invoices. Optional filters: studentId, status.',
      inputSchema: { studentId: z.string().optional(), status: z.string().optional(), limit: z.number().int().min(1).max(100).optional() },
    }, async (o: { studentId?: string; status?: string; limit?: number }) => json(await q.listInvoices(o)));

    s.registerTool('list_reminders', { description: 'List student reminders.', inputSchema: { limit: z.number().int().min(1).max(200).optional() } },
      async ({ limit }: { limit?: number }) => json(await q.listReminders(limit)));

    s.registerTool('list_events', { description: 'List upcoming events.', inputSchema: {} }, async () => json(await q.listEvents()));

    s.registerTool('list_request_types', { description: 'List task/request types (needed to create structured student tasks).', inputSchema: {} },
      async () => json(await q.listRequestTypes()));

    // ------------------------------------------------ Universal write layer
    s.registerTool('list_capabilities', {
      description: 'Discover EVERY action the website supports (112 actions across all domains: students, applications, tasks, chat, invoices, users, universities, checklist, reminders, notifications, documents, reports). Returns each action name + signature + whether it is destructive. Optionally filter by domain. Use this, then call run_action.',
      inputSchema: { domain: z.string().optional() },
    }, async ({ domain }: { domain?: string }) => json(listCapabilities(domain)));

    s.registerTool('run_action', {
      description: 'Execute ANY website action by name (see list_capabilities). Pass args as an object with the named params from the signature; params shown as <you> are filled with your identity automatically. Destructive/high-impact actions require confirm:true — if omitted you get a confirmation prompt back instead of executing.',
      inputSchema: {
        action: z.string(),
        args: z.record(z.string(), z.any()).optional(),
        confirm: z.boolean().optional(),
      },
    }, async ({ action, args, confirm }: { action: string; args?: Record<string, unknown>; confirm?: boolean }, extra: Extra) =>
      json(await runAction({ action, args, confirm }, actorFrom(extra))));
  }, {
    serverInfo: { name: 'masar-tasks', version: '2.0.0' },
  });

  cached = withMcpAuth(base, verifyToken, { required: true });
  return cached;
}
