// Public READ-ONLY REST API (v1) for external integrations.
//
// One catch-all route handles every resource. Auth is a bearer token from the
// `mcp_tokens` collection (share a { readonly: true } token with a viewer). Only GET
// is allowed — every write verb returns 405 — so this surface can never modify data.
//
// Examples:
//   GET /api/v1                          -> index of endpoints
//   GET /api/v1/students?limit=50        -> student summaries (filters below)
//   GET /api/v1/students?q=<name|phone>  -> search students
//   GET /api/v1/students/<id>            -> one full student profile
//   GET /api/v1/students/<id>/chat       -> internal chat for a student
//   GET /api/v1/students/<id>/tasks      -> tasks attached to a student
//   GET /api/v1/tasks?status=new         -> request tasks (add &count=1 for a count)
//   GET /api/v1/notifications            -> activity-feed records
//   GET /api/v1/employees | universities | invoices | reminders | events | request-types
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { authenticate } from '@/lib/api/rest-auth';
import * as q from '@/lib/mcp/query-tools';
import * as tasks from '@/lib/mcp/task-tools';
import type { TaskStatus } from '@/lib/types';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

const err = (status: number, message: string) => jsonResponse({ error: message }, status);

const num = (v: string | null, d?: number) => {
  if (v == null) return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const bool = (v: string | null) => (v == null ? undefined : v === 'true' || v === '1');

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Any write verb is explicitly refused — this API is read-only.
function methodNotAllowed() {
  return err(405, 'This API is read-only. Only GET is supported.');
}
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;

const INDEX = {
  name: 'masar read-only API v1',
  readOnly: true,
  auth: 'Send header "Authorization: Bearer <token>" (or ?token=<token> for quick tests).',
  endpoints: {
    'GET /api/v1/students': 'List students. Query: q (name/phone search), employeeId, pipelineStatus, changeAgentRequired, jotform, hasChangeAgentHistory, limit (max 100).',
    'GET /api/v1/students/{id}': 'Full student profile.',
    'GET /api/v1/students/{id}/chat': 'Internal chat messages. Query: limit (max 200).',
    'GET /api/v1/students/{id}/tasks': 'Tasks attached to the student.',
    'GET /api/v1/tasks': 'Request tasks. Query: status, recipientId, taskType, cursor, limit (max 100), count=1.',
    'GET /api/v1/notifications': 'Activity-feed records. Query: recipientId, cursor, limit.',
    'GET /api/v1/tasks/{id}': 'One task with replies.',
    'GET /api/v1/employees': 'All staff/users.',
    'GET /api/v1/universities': 'Approved universities.',
    'GET /api/v1/invoices': 'Invoices. Query: studentId, status, limit.',
    'GET /api/v1/reminders': 'Student reminders. Query: limit.',
    'GET /api/v1/events': 'Upcoming events.',
    'GET /api/v1/request-types': 'Task/request types.',
  },
};

export async function GET(req: Request, ctx: { params: { path?: string[] } }) {
  const auth = await authenticate(req);
  if (!auth.ok) return err(auth.status, auth.error);

  const path = ctx.params.path ?? [];
  const sp = new URL(req.url).searchParams;

  try {
    // /api/v1
    if (path.length === 0) return jsonResponse(INDEX);

    const [resource, id, sub] = path;

    switch (resource) {
      case 'students': {
        if (!id) {
          const query = sp.get('q');
          if (query) return jsonResponse(await q.searchStudents(query, num(sp.get('limit'), 20)));
          return jsonResponse(await q.listStudents({
            employeeId: sp.get('employeeId') ?? undefined,
            pipelineStatus: sp.get('pipelineStatus') ?? undefined,
            changeAgentRequired: bool(sp.get('changeAgentRequired')),
            jotform: bool(sp.get('jotform')),
            hasChangeAgentHistory: bool(sp.get('hasChangeAgentHistory')),
            limit: num(sp.get('limit'), 25),
          }));
        }
        if (sub === 'chat') return jsonResponse(await q.getStudentChat(id, num(sp.get('limit'), 50)));
        if (sub === 'tasks') return jsonResponse(await tasks.getTasksForStudent(id));
        if (sub) return err(404, `Unknown sub-resource "students/${id}/${sub}".`);
        const student = await q.getStudent(id);
        return student ? jsonResponse(student) : err(404, 'Student not found.');
      }

      case 'tasks': {
        if (id) {
          const t = await tasks.getTask(id);
          return t ? jsonResponse(t) : err(404, 'Task not found.');
        }
        const opts = {
          status: (sp.get('status') as TaskStatus | null) ?? undefined,
          recipientId: sp.get('recipientId') ?? undefined,
          taskType: sp.get('taskType') ?? undefined,
        };
        if (bool(sp.get('count'))) return jsonResponse(await tasks.countTasks(opts));
        return jsonResponse(await tasks.listTasks({ ...opts, cursor: sp.get('cursor') ?? undefined, limit: num(sp.get('limit'), 25) }));
      }

      case 'notifications':
        return jsonResponse(await tasks.listNotifications({
          recipientId: sp.get('recipientId') ?? undefined,
          cursor: sp.get('cursor') ?? undefined,
          limit: num(sp.get('limit'), 25),
        }));

      case 'employees':
        return jsonResponse(await q.listEmployees());
      case 'universities':
        return jsonResponse(await q.listUniversities());
      case 'invoices':
        return jsonResponse(await q.listInvoices({
          studentId: sp.get('studentId') ?? undefined,
          status: sp.get('status') ?? undefined,
          limit: num(sp.get('limit'), 25),
        }));
      case 'reminders':
        return jsonResponse(await q.listReminders(num(sp.get('limit'), 50)));
      case 'events':
        return jsonResponse(await q.listEvents());
      case 'request-types':
        return jsonResponse(await q.listRequestTypes());

      default:
        return err(404, `Unknown resource "${resource}". GET /api/v1 for the endpoint index.`);
    }
  } catch (e) {
    return err(500, e instanceof Error ? e.message : 'Internal error.');
  }
}
