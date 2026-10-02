// Tool surface for the masar AI assistant.
//
// Design notes:
//  - Read tools reuse src/lib/mcp/query-tools.ts and task-tools.ts rather than
//    re-querying Firestore, so the assistant sees exactly what the MCP integration sees.
//  - The four capabilities asked for map to: generate_report, find_late_applications,
//    send_email, upload_student_document.
//  - run_action exposes every server action through the existing MCP dispatcher, but
//    is gated behind an explicit per-request `allowWrites` flag which defaults to OFF.
//    Destructive actions additionally require confirm:true, enforced inside dispatch.ts.

import type Anthropic from '@anthropic-ai/sdk';
import type { Actor } from '@/lib/mcp/dispatch';
import { listCapabilities, runAction } from '@/lib/mcp/dispatch';
import * as queries from '@/lib/mcp/query-tools';
import * as taskTools from '@/lib/mcp/task-tools';
import { getReportStats } from '@/lib/actions';
import { findLateApplications, getLateRules, TRACKED_STATUSES } from '@/lib/late-applications';
import { sendEmail, getEmailConfigStatus } from '@/lib/email';
import { uploadStudentDocument } from '@/lib/documents/upload';
import type { Country, TaskStatus } from '@/lib/types';
import { countRecords } from './count';
import { findChatsAwaitingReply, readStudentChat, replyInStudentChat } from './chat-tools';
import { addTeamNote, getWorkGuide, WORK_GUIDE_TOPICS } from './knowledge';
import { getStudentDocumentCards, readStudentDocuments } from './documents';

export type ToolContext = {
  actor: Actor;
  /** When false, every write tool refuses. Defaults to false at the call site. */
  allowWrites: boolean;
};

type ToolHandler = (input: Record<string, any>, ctx: ToolContext) => Promise<unknown>;

export type AiTool = {
  definition: Anthropic.Tool;
  handler: ToolHandler;
  /** Write tools are only offered to the model when allowWrites is true. */
  write: boolean;
};

const WRITES_DISABLED_MESSAGE =
  'Write mode is off for this conversation, so this tool is unavailable. The user must ' +
  'turn on "Allow changes" before anything can be created, modified, sent, or uploaded.';

function guardWrite(ctx: ToolContext) {
  if (!ctx.allowWrites) throw new Error(WRITES_DISABLED_MESSAGE);
}

// --------------------------------------------------------------------------
// Read tools
// --------------------------------------------------------------------------

const listStudentsTool: AiTool = {
  write: false,
  definition: {
    name: 'list_students',
    description:
      'List students, optionally filtered. Returns a compact summary per student ' +
      '(name, phone, assigned employee, pipeline status, applications). Use search_students ' +
      'when looking for a specific person by name or phone.',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: "Assigned employee's civil ID." },
        pipelineStatus: { type: 'string', description: 'e.g. green, yellow, orange, none.' },
        changeAgentRequired: { type: 'boolean' },
        limit: { type: 'integer', description: 'Max rows, 1-100. Default 25.' },
      },
    },
  },
  handler: (input) =>
    queries.listStudents({
      employeeId: input.employeeId,
      pipelineStatus: input.pipelineStatus,
      changeAgentRequired: input.changeAgentRequired,
      limit: input.limit,
    }),
};

const searchStudentsTool: AiTool = {
  write: false,
  definition: {
    name: 'search_students',
    description:
      'Find students by exact phone number or by name prefix (works for Arabic and Latin names).',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name prefix or exact phone number.' },
        limit: { type: 'integer', description: 'Max rows, 1-50. Default 20.' },
      },
      required: ['query'],
    },
  },
  handler: (input) => queries.searchStudents(input.query, input.limit),
};

const getStudentTool: AiTool = {
  write: false,
  definition: {
    name: 'get_student',
    description:
      'Fetch a single full student record by id, including applications, documents, notes and checklist state.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' } },
      required: ['studentId'],
    },
  },
  handler: async (input) => {
    const student = await queries.getStudent(input.studentId);
    return student ?? { error: `No student found with id ${input.studentId}.` };
  },
};

const listTasksTool: AiTool = {
  write: false,
  definition: {
    name: 'list_tasks',
    description:
      'List tasks/requests. Filter by status, recipient or task type. Note the tasks ' +
      'collection also holds system notifications; this returns real tasks.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['new', 'in-progress', 'completed', 'denied'] },
        recipientId: { type: 'string' },
        taskType: { type: 'string' },
        limit: { type: 'integer', description: 'Max rows. Default 25.' },
      },
    },
  },
  handler: (input) =>
    taskTools.listTasks({
      status: input.status as TaskStatus | undefined,
      recipientId: input.recipientId,
      taskType: input.taskType,
      limit: input.limit,
    }),
};

const listEmployeesTool: AiTool = {
  write: false,
  definition: {
    name: 'list_employees',
    description:
      'List all system users (employees, departments, admins) with their ids, civil IDs, roles and departments. ' +
      'Use this to turn an employeeId (a civil ID) from other results into a human name.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: () => queries.listEmployees(),
};

const listUniversitiesTool: AiTool = {
  write: false,
  definition: {
    name: 'list_universities',
    description: 'List the approved universities configured in the system.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: () => queries.listUniversities(),
};

// --------------------------------------------------------------------------
// Capability 1 — reports
// --------------------------------------------------------------------------

const generateReportTool: AiTool = {
  write: false,
  definition: {
    name: 'generate_report',
    description:
      'Pull aggregate statistics for a date range: totals for students/applications/employees, ' +
      'application status and country breakdowns, student growth over time, students per employee, ' +
      'and employee logged hours. This returns raw numbers — write the narrative report yourself ' +
      'from them, and say which period the numbers cover.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start of the range, ISO date e.g. 2026-01-01.' },
        to: { type: 'string', description: 'End of the range, ISO date e.g. 2026-03-31.' },
      },
      required: ['from', 'to'],
    },
  },
  handler: async (input) => {
    const result = await getReportStats({ from: input.from, to: input.to });
    if (!result.success) return { error: result.message ?? 'Could not build report statistics.' };
    return { range: { from: input.from, to: input.to }, ...result.data };
  },
};

// --------------------------------------------------------------------------
// Capability 2 — late applications
// --------------------------------------------------------------------------

const findLateApplicationsTool: AiTool = {
  write: false,
  definition: {
    name: 'find_late_applications',
    description:
      'Find applications that have sat in a non-final status longer than the configured threshold. ' +
      'Lateness is measured from the application\'s last status change. Accepted and Rejected are ' +
      'never late, and closed students are excluded. Returns the thresholds used alongside the ' +
      'results — always state them when reporting, since they are a configurable business rule, ' +
      'not a hard deadline from a university. Passing employeeId makes the scan much cheaper.',
    input_schema: {
      type: 'object',
      properties: {
        employeeId: { type: 'string', description: "Limit to one employee's portfolio (civil ID)." },
        country: { type: 'string', enum: ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'] },
        status: { type: 'string', enum: [...TRACKED_STATUSES] },
        limit: { type: 'integer', description: 'Max rows returned, most overdue first. Default 50.' },
      },
    },
  },
  handler: (input) =>
    findLateApplications({
      employeeId: input.employeeId,
      country: input.country as Country | undefined,
      status: input.status,
      limit: input.limit,
    }),
};

const getLateRulesTool: AiTool = {
  write: false,
  definition: {
    name: 'get_late_application_rules',
    description:
      'Read the current day thresholds that define when an application counts as late, per status.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: () => getLateRules(),
};

// --------------------------------------------------------------------------
// Capability 3 — email
// --------------------------------------------------------------------------

const emailStatusTool: AiTool = {
  write: false,
  definition: {
    name: 'get_email_status',
    description:
      'Check whether email sending is configured and whether dry-run mode or a recipient ' +
      'domain allowlist is active. Check this before promising to send anything.',
    input_schema: { type: 'object', properties: {} },
  },
  handler: async () => getEmailConfigStatus(),
};

const sendEmailTool: AiTool = {
  write: true,
  definition: {
    name: 'send_email',
    description:
      'Send an email. Show the user the exact recipient, subject and body and get their ' +
      'explicit approval before calling this — an email cannot be unsent. If dry-run mode is ' +
      'on, the message is logged but not delivered; say so plainly in that case rather than ' +
      'claiming it was sent.',
    input_schema: {
      type: 'object',
      properties: {
        to: {
          oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Recipient address, or an array of addresses.',
        },
        subject: { type: 'string' },
        text: { type: 'string', description: 'Plain-text body. Provide this or html.' },
        html: { type: 'string', description: 'HTML body. Provide this or text.' },
        cc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        bcc: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        replyTo: { type: 'string' },
      },
      required: ['to', 'subject'],
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    return sendEmail(
      {
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.replyTo,
      },
      { triggeredBy: ctx.actor.id, triggeredByName: ctx.actor.name, source: 'ai-assistant' },
    );
  },
};

// --------------------------------------------------------------------------
// Capability 4 — document upload
// --------------------------------------------------------------------------

const uploadDocumentTool: AiTool = {
  write: true,
  definition: {
    name: 'upload_student_document',
    description:
      'Attach a document to a student profile. Content must be base64-encoded. Use this for ' +
      'files the user pasted or that you generated; you cannot read files from the user\'s ' +
      'computer yourself. The upload notifies the other side (admin or employee) exactly like ' +
      'a manual upload does.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        filename: { type: 'string', description: 'Original filename with extension, e.g. offer-letter.pdf.' },
        contentBase64: { type: 'string', description: 'Base64-encoded file bytes, no data: prefix.' },
        contentType: { type: 'string', description: 'MIME type. Inferred from the extension when omitted.' },
        customName: { type: 'string', description: 'Display name shown in the UI. Defaults to filename.' },
        note: { type: 'string' },
        section: { type: 'string', enum: ['employee', 'admin'], description: 'Which panel it belongs to. Default admin.' },
      },
      required: ['studentId', 'filename', 'contentBase64'],
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    return uploadStudentDocument({
      studentId: input.studentId,
      filename: input.filename,
      content: input.contentBase64,
      contentType: input.contentType,
      customName: input.customName,
      note: input.note,
      section: input.section,
      uploaderId: ctx.actor.id,
    });
  },
};

// --------------------------------------------------------------------------
// How the agency works
// --------------------------------------------------------------------------

const getWorkGuideTool: AiTool = {
  write: false,
  definition: {
    name: 'get_work_guide',
    description:
      "Read how masar and the agency work: roles and who sees what, the student lifecycle, " +
      'pipeline colours, applications, checklists, documents/chat/notes, tasks and requests, ' +
      'JotForm, universities, invoices and reports — plus the live settings (request types, ' +
      'checklists, lateness thresholds, terms) and the team\'s own notes. Read it before ' +
      'answering any question about process, rules or "how do we…", and before acting on ' +
      'something you are unsure how the agency handles. Team notes override the guide.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: WORK_GUIDE_TOPICS, description: 'Omit to read everything.' },
      },
    },
  },
  handler: (input) => getWorkGuide(input.topic),
};

const saveTeamNoteTool: AiTool = {
  write: true,
  definition: {
    name: 'save_team_note',
    description:
      "Save a rule or fact about how the agency works, so you know it in every future " +
      'conversation and in the internal chat. Use it when the user tells you something to ' +
      'remember ("orange means…", "Ireland goes to the UK team"). Write it as one clear ' +
      'sentence in the user\'s own terms, show it to them, and save only after they approve.',
    input_schema: {
      type: 'object',
      properties: {
        topic: { type: 'string', enum: [...WORK_GUIDE_TOPICS, 'general'] },
        text: { type: 'string' },
      },
      required: ['topic', 'text'],
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    const note = await addTeamNote({ topic: input.topic, text: input.text, addedBy: ctx.actor.name });
    return { ok: true, saved: note };
  },
};

// --------------------------------------------------------------------------
// Documents
// --------------------------------------------------------------------------

const getStudentDocumentsTool: AiTool = {
  write: false,
  definition: {
    name: 'get_student_documents',
    description:
      "What is in a student's documents: for each file, its type (offer, passport, IELTS, " +
      'transcript, CAS…), a one-line summary and the facts read from it — offer type and ' +
      'conditions, deposit and deadlines, IELTS bands, grades, passport expiry. Use this for ' +
      'any question about what a document says. Files marked "not yet read" can be read ' +
      'with read_student_documents.',
    input_schema: {
      type: 'object',
      properties: { studentId: { type: 'string' } },
      required: ['studentId'],
    },
  },
  handler: (input) => getStudentDocumentCards(input.studentId),
};

const readStudentDocumentsTool: AiTool = {
  write: false,
  definition: {
    name: 'read_student_documents',
    description:
      "Read a student's documents that have not been read yet (or all of them again with " +
      'force) and store what each one says. Takes a few seconds per file. Afterwards call ' +
      'get_student_documents.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        force: { type: 'boolean', description: 'Re-read documents that were already read.' },
      },
      required: ['studentId'],
    },
  },
  handler: async (input) => {
    const r = await readStudentDocuments(input.studentId, { force: input.force === true });
    if ('error' in r) return r;
    return { studentId: r.studentId, read: r.read, alreadyRead: r.alreadyRead, next: 'Call get_student_documents to see the results.' };
  },
};

// --------------------------------------------------------------------------
// Counting
// --------------------------------------------------------------------------

const COUNTRIES = ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'];

const countRecordsTool: AiTool = {
  write: false,
  definition: {
    name: 'count_records',
    description:
      'Get an EXACT count of students, applications or tasks, with any combination of filters, ' +
      'optionally broken down by a field. Use this for every "how many" question instead of ' +
      'listing rows and counting them yourself — list tools stop at 100 rows, this reads ' +
      'everything. Closed students are excluded unless filters.closed says otherwise. Always ' +
      'repeat the filters you used when you give the number.\n' +
      'entity=students counts people; entity=applications counts each application separately ' +
      '(one student with three UK applications is 3). For students, country matches a target ' +
      'country or any application in that country. Date range: students by createdAt, ' +
      'applications by updatedAt (last status change), tasks by createdAt. Task counts cover real ' +
      'requests only, the same set the /tasks page shows.',
    input_schema: {
      type: 'object',
      properties: {
        entity: { type: 'string', enum: ['students', 'applications', 'tasks'] },
        filters: {
          type: 'object',
          properties: {
            employeeId: { type: 'string', description: "Assigned employee's civil ID (students/applications)." },
            pipelineStatus: { type: 'string', enum: ['green', 'yellow', 'orange', 'red', 'black', 'none'] },
            country: { type: 'string', enum: COUNTRIES },
            applicationStatus: { type: 'string', enum: ['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'] },
            university: { type: 'string', description: 'Part of the university name, case-insensitive.' },
            major: { type: 'string', description: 'Part of the major, case-insensitive.' },
            studyLevel: { type: 'string', enum: ['Foundation', 'First Year', 'Transfer Student'] },
            term: { type: 'string' },
            intakeYear: { type: 'integer' },
            intakeSemester: { type: 'string' },
            gender: { type: 'string', enum: ['M', 'F'] },
            schoolType: { type: 'string', enum: ['Private', 'Public'] },
            jotform: { type: 'boolean', description: 'Created through the JotForm flow.' },
            finalized: { type: 'boolean', description: 'Has a final university choice.' },
            changeAgentRequired: { type: 'boolean' },
            hasMissingItems: { type: 'boolean' },
            ieltsMin: { type: 'number' },
            ieltsMax: { type: 'number' },
            closed: { type: 'string', enum: ['exclude', 'only', 'include'], description: 'Default exclude.' },
            from: { type: 'string', description: 'ISO date, inclusive.' },
            to: { type: 'string', description: 'ISO date, inclusive.' },
            taskStatus: { type: 'string', enum: ['new', 'in-progress', 'completed', 'denied'] },
            taskType: { type: 'string' },
            recipientId: { type: 'string', description: 'Task recipient user id.' },
          },
        },
        groupBy: {
          type: 'string',
          enum: [
            'none', 'employee', 'country', 'applicationStatus', 'university', 'pipelineStatus',
            'studyLevel', 'term', 'intake', 'month', 'gender', 'taskType', 'taskStatus',
          ],
          description: 'Break the total down by this field. employee gives names, not civil IDs.',
        },
        listNames: {
          type: 'boolean',
          description: 'Also return up to 50 matching student names (students/applications only).',
        },
      },
      required: ['entity'],
    },
  },
  handler: (input) =>
    countRecords({
      entity: input.entity,
      filters: input.filters,
      groupBy: input.groupBy,
      listNames: input.listNames,
    }),
};

// --------------------------------------------------------------------------
// Internal chat
// --------------------------------------------------------------------------

const findChatsAwaitingReplyTool: AiTool = {
  write: false,
  definition: {
    name: 'find_chats_awaiting_reply',
    description:
      "Find students' internal staff chats where the newest message is still waiting on " +
      'someone: it was addressed to a person or group, or asked a question, and nobody has ' +
      'written since. Longest-waiting first. Pass userId to see only what is waiting on one person.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How far back to look, 1-60. Default 7.' },
        userId: { type: 'string', description: 'Only messages addressed to this user (users.id, not civil ID).' },
        limit: { type: 'integer', description: 'Max threads, 1-100. Default 30.' },
      },
    },
  },
  handler: (input) => findChatsAwaitingReply({ days: input.days, userId: input.userId, limit: input.limit }),
};

const readStudentChatTool: AiTool = {
  write: false,
  definition: {
    name: 'read_student_chat',
    description:
      "Read a student's internal staff chat, oldest first, with who wrote each message and who it was addressed to.",
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        limit: { type: 'integer', description: 'Most recent N messages, 1-100. Default 30.' },
      },
      required: ['studentId'],
    },
  },
  handler: (input) => readStudentChat(input.studentId, input.limit),
};

const replyInStudentChatTool: AiTool = {
  write: true,
  definition: {
    name: 'reply_in_student_chat',
    description:
      "Post a reply in a student's internal staff chat. It is posted as Masar AI, not as the " +
      'user. By default it notifies the person who wrote the newest staff message; pass ' +
      'notifyUserIds to choose. Read the chat first, show the user the exact reply and wait for ' +
      'approval before calling this. Never state a fact in the reply that you did not read from the record.',
    input_schema: {
      type: 'object',
      properties: {
        studentId: { type: 'string' },
        content: { type: 'string', description: 'The message, in the language the thread uses.' },
        notifyUserIds: { type: 'array', items: { type: 'string' } },
      },
      required: ['studentId', 'content'],
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    return replyInStudentChat({
      studentId: input.studentId,
      content: input.content,
      notifyUserIds: input.notifyUserIds,
    });
  },
};

// --------------------------------------------------------------------------
// General action dispatch (everything else masar can do)
// --------------------------------------------------------------------------

const listCapabilitiesTool: AiTool = {
  write: true,
  definition: {
    name: 'list_capabilities',
    description:
      'List every masar server action available through run_action, grouped by domain, with ' +
      'its signature and whether it is destructive. Call this before run_action to get the ' +
      'exact action name and argument names.',
    input_schema: {
      type: 'object',
      properties: { domain: { type: 'string', description: 'Optional domain filter, e.g. students.' } },
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    return listCapabilities(input.domain);
  },
};

const runActionTool: AiTool = {
  write: true,
  definition: {
    name: 'run_action',
    description:
      'Execute a masar server action by name. Discover valid names and arguments with ' +
      'list_capabilities first. Destructive actions refuse unless confirm is true — never set ' +
      'confirm without the user having explicitly approved that specific action in this conversation.',
    input_schema: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        args: { type: 'object', description: 'Arguments by parameter name.' },
        confirm: { type: 'boolean', description: 'Required for destructive actions.' },
      },
      required: ['action'],
    },
  },
  handler: async (input, ctx) => {
    guardWrite(ctx);
    return runAction({ action: input.action, args: input.args, confirm: input.confirm }, ctx.actor);
  },
};

// --------------------------------------------------------------------------

export const AI_TOOLS: AiTool[] = [
  listStudentsTool,
  searchStudentsTool,
  getStudentTool,
  getStudentDocumentsTool,
  readStudentDocumentsTool,
  listTasksTool,
  listEmployeesTool,
  listUniversitiesTool,
  getWorkGuideTool,
  saveTeamNoteTool,
  countRecordsTool,
  generateReportTool,
  findLateApplicationsTool,
  getLateRulesTool,
  emailStatusTool,
  sendEmailTool,
  uploadDocumentTool,
  findChatsAwaitingReplyTool,
  readStudentChatTool,
  replyInStudentChatTool,
  listCapabilitiesTool,
  runActionTool,
];

const TOOL_MAP = new Map(AI_TOOLS.map((t) => [t.definition.name, t]));

/** Build a lookup for a custom tool surface (the chat responder uses its own). */
export function buildToolRegistry(tools: AiTool[]): Map<string, AiTool> {
  return new Map(tools.map((t) => [t.definition.name, t]));
}

/**
 * Tool definitions to send to the model. Write tools are withheld entirely when writes
 * are off — the model cannot call what it cannot see, and the handlers still guard.
 *
 * Order is stable so the prompt cache prefix stays intact across turns.
 */
export function getToolDefinitions(allowWrites: boolean): Anthropic.Tool[] {
  return AI_TOOLS.filter((t) => allowWrites || !t.write).map((t) => t.definition);
}

export type ToolExecution = {
  name: string;
  input: unknown;
  result: unknown;
  isError: boolean;
  durationMs: number;
};

/** Run one tool call. Never throws — failures come back as an error result for the model. */
export async function executeTool(
  name: string,
  input: Record<string, any>,
  ctx: ToolContext,
  registry: Map<string, AiTool> = TOOL_MAP,
): Promise<ToolExecution> {
  const started = Date.now();
  const tool = registry.get(name);

  if (!tool) {
    return {
      name,
      input,
      result: { error: `Unknown tool "${name}".` },
      isError: true,
      durationMs: Date.now() - started,
    };
  }

  if (tool.write && !ctx.allowWrites) {
    return {
      name,
      input,
      result: { error: WRITES_DISABLED_MESSAGE },
      isError: true,
      durationMs: Date.now() - started,
    };
  }

  try {
    const result = await tool.handler(input, ctx);
    return { name, input, result: result ?? null, isError: false, durationMs: Date.now() - started };
  } catch (e) {
    return {
      name,
      input,
      result: { error: e instanceof Error ? e.message : String(e) },
      isError: true,
      durationMs: Date.now() - started,
    };
  }
}
