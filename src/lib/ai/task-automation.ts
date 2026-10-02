// Acting on a request the moment it is created.
//
//   Add-school requests (UK Foundation, USA, UK First Year — any request type whose form
//   picks schools from Approved Universities): every chosen school is added to the
//   student's University Applications with status Pending, through addApplication, so
//   the employee is notified exactly as when it is added by hand. Schools already on the
//   student are skipped.
//
//   "Request Update on a student application" (UK, USA, AU/NZ): the request carries only
//   the employee's own words ("update?", "please add the passport", "change the offers to
//   2027"). The AI reads them with the student's applications, email history and
//   documents, finds the conversation with the company handling it, and drafts the email
//   in Gmail — asking for the update, or passing the instruction on, with any document it
//   names attached. Nothing is sent.
//
// Either way, what was done is written back on the task as a reply, so the department
// handling it sees it immediately. Each task is processed once (a claim on the task).

import Anthropic from '@anthropic-ai/sdk';
import nodemailer from 'nodemailer';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from './client';
import { AI_DOC_MODEL, isAiConfigured } from './config';
import { CHAT_BOT_NAME, CHAT_BOT_USER_ID, ensureChatBotUser } from './chat-bot';
import { addApplication } from '@/lib/actions';
import { appendDraft, isInboxConfigured } from '@/lib/email/inbox';
import { backfillStudentEmails, EMAIL_MEMORY_COLLECTION, type EmailMemoryEntry } from '@/lib/email/memory';
import { downloadDoc } from '@/lib/email/requests';
import { replyWithReceipt } from '@/lib/email/reply-receipt';
import { logAiAction } from './action-log';
import type { Application } from '@/lib/types';

const DRAFT_SIGNATURE = 'MMohammed';
const ATTACH_LIMIT = 17 * 1024 * 1024;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

type TaskKind = 'add_schools' | 'update_request' | null;

export type TaskAutomationResult = { taskId: string; kind: TaskKind; status: 'done' | 'skipped' | 'error'; lines: string[] };

function kindOf(task: Record<string, any>): TaskKind {
  const name = String(task.taskType ?? '').toLowerCase();
  const data = task.data ?? {};
  if (/request update/.test(name)) return 'update_request';
  // Change-major requests point at an existing application; they are not new schools.
  if (/change major/.test(name)) return null;
  if (data.selectedGlobalUniversityDetails?.name || (Array.isArray(data.selectedGlobalUniversities) && data.selectedGlobalUniversities.length)) {
    return 'add_schools';
  }
  return null;
}

async function claim(taskId: string): Promise<Record<string, any> | null> {
  const ref = db().collection('tasks').doc(taskId);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const t = snap.data()!;
    if (t.aiAutomation?.status) return null;
    tx.update(ref, { aiAutomation: { status: 'processing', at: new Date().toISOString() } });
    return { id: snap.id, ...t };
  });
}

async function finish(taskId: string, result: TaskAutomationResult) {
  const ref = db().collection('tasks').doc(taskId);
  const update: Record<string, unknown> = {
    aiAutomation: { status: result.status, kind: result.kind, at: new Date().toISOString(), lines: result.lines },
  };
  if (result.lines.length) {
    await ensureChatBotUser();
    const snap = await ref.get();
    const replies = (snap.data()?.replies ?? []) as unknown[];
    update.replies = [
      ...replies,
      {
        id: `reply-ai-${Date.now()}`,
        authorId: CHAT_BOT_USER_ID,
        authorName: CHAT_BOT_NAME,
        content: result.lines.join('\n'),
        createdAt: new Date().toISOString(),
      },
    ];
  }
  await ref.update(update);
}

// --------------------------------------------------------------------------
// Add schools
// --------------------------------------------------------------------------

async function addSchools(task: Record<string, any>, dryRun = false): Promise<string[]> {
  const data = task.data ?? {};
  const chosen: Array<{ name: string; major: string; country: string }> = (
    Array.isArray(data.selectedGlobalUniversities) && data.selectedGlobalUniversities.length
      ? data.selectedGlobalUniversities
      : [data.selectedGlobalUniversityDetails]
  ).filter((u: any) => u?.name);

  const snap = await db().collection('students').doc(task.studentId).get();
  const s = snap.data();
  if (!s) return ['⚠️ Student not found — nothing was added.'];
  const have = new Set(
    ((s.applications ?? []) as Application[]).map((a) => `${a.university}|${a.major}`.toLowerCase().trim()),
  );

  const lines: string[] = [];
  for (const u of chosen) {
    const key = `${u.name}|${u.major}`.toLowerCase().trim();
    if (have.has(key)) {
      lines.push(`ℹ️ ${u.name} (${u.major}) is already on the profile — not added again.`);
      continue;
    }
    if (dryRun) {
      lines.push(`[preview] would add as Pending: ${u.name} (${u.major}, ${u.country})`);
      continue;
    }
    const r = await addApplication(task.studentId, u.name, u.country, u.major, s.name, s.employeeId ?? null);
    if (r.success) {
      have.add(key);
      lines.push(`✅ Added to University Applications as Pending: ${u.name} (${u.major})`);
      await logAiAction({
        source: 'task',
        summary: `Added as Pending: ${u.name} (${u.major})`,
        reason: `Request "${String(task.taskType ?? '').trim()}" by ${task.authorName ?? 'staff'}`,
        studentId: task.studentId,
        studentName: s.name ?? null,
        undo: { type: 'remove_application', university: u.name, major: u.major },
      });
    } else {
      lines.push(`⚠️ Could not add ${u.name}: ${r.message}`);
    }
  }
  return lines;
}

// --------------------------------------------------------------------------
// Update request → draft email
// --------------------------------------------------------------------------

const UPDATE_SYSTEM = `An employee of a Kuwaiti study-abroad agency raised a request about a student's application(s). Turn it into email(s) to the company handling the application (agent or provider: Merit, INTO, Study Group, Navitas…), to be saved as drafts and sent by a person. Call record_drafts once.

- The employee's words may be just "update?" — then ask for an update on the student's applications that are still waiting (Pending, Submitted, Missing Items). Or they may be an instruction ("please add the passport", "change the offers to 2027") — then pass that instruction on, clearly and politely, in English.
- Pick the conversation from the numbered email list: the email to reply to, from the conversation that handles the application(s) concerned (prefer the most recent email of that conversation). One draft per conversation. If the request concerns applications handled in different conversations, make one draft for each.
- If the request names a document (passport, transcript, IELTS…), attach it: give its id from the documents list. Only attach what the request asks for.
- body: short, in the agency's style, inside an existing thread — greeting ("Dear <organisation> Team,"), one or two lines, no sign-off (added afterwards). Do not repeat the student's name or references; the thread has them. Name the university when the conversation covers several.
- If no conversation fits, return no draft and say why in problem.`;

const UPDATE_TOOL: Anthropic.Tool = {
  name: 'record_drafts',
  description: 'The drafts to create for this request.',
  input_schema: {
    type: 'object',
    properties: {
      drafts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            email: { type: 'integer', description: 'Index of the email to reply to.' },
            about: { type: 'string', description: 'Short: which applications / what it asks.' },
            body: { type: 'string' },
            attach: { type: 'array', items: { type: 'string' }, description: 'Document ids to attach.' },
          },
          required: ['email', 'about', 'body'],
        },
      },
      problem: { type: ['string', 'null'] },
    },
    required: ['drafts'],
  },
};

const firstAddress = (s: string) => s.match(/[\w.+-]+@[\w.-]+/)?.[0]?.toLowerCase() ?? '';

async function draftUpdate(task: Record<string, any>, dryRun = false): Promise<string[]> {
  if (!isInboxConfigured()) return ['⚠️ The mailbox is not configured — no draft was made.'];
  const snap = await db().collection('students').doc(task.studentId).get();
  const s = snap.data();
  if (!s) return ['⚠️ Student not found.'];
  const mailbox = (process.env.SMTP_USER ?? '').trim().toLowerCase();

  const load = async () =>
    (await db().collection(EMAIL_MEMORY_COLLECTION).where('studentId', '==', task.studentId).get()).docs
      .map((d) => d.data() as EmailMemoryEntry)
      .filter((e) => e.messageId)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 40);
  let emails = await load();
  if (!emails.length) {
    await backfillStudentEmails(task.studentId, { limit: 80 });
    emails = await load();
  }
  if (!emails.length) return ['⚠️ No email conversation with any company was found for this student — please email them directly.'];

  const docs = ((s.documents ?? []) as Array<Record<string, any>>).filter((d) => d.id);
  const apps = (s.applications ?? []) as Application[];
  const note = String(task.data?.notes ?? task.content ?? '').trim();

  const res = await getAnthropicClient().messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 1500,
    system: UPDATE_SYSTEM,
    tools: [UPDATE_TOOL],
    messages: [
      {
        role: 'user',
        content: [
          `Request type: ${task.taskType}`,
          `Employee's words: ${note || '(none — just asking for an update)'}`,
          '',
          'Applications:',
          ...apps.map((a) => `- ${a.university} — ${a.major} (${a.country}) — ${a.status}`),
          '',
          'Emails (newest first):',
          ...emails.map(
            (e, i) =>
              `${i}. ${e.date.slice(0, 10)} ${e.direction === 'in' ? `from ${e.from}` : `to ${e.to}`} | ${e.subject} | ${e.summary}`,
          ),
          '',
          'Documents on the profile:',
          ...docs.map((d) => `- ${d.id}: ${d.name}${d.ai?.type ? ` [${d.ai.type}]` : ''}`),
        ].join('\n'),
      },
    ],
  });
  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  const out = (use?.input ?? {}) as { drafts?: any[]; problem?: string | null };
  if (!out.drafts?.length) return [`⚠️ No draft made: ${out.problem ?? 'could not tell which conversation this is about.'}`];

  const lines: string[] = [];
  const done = new Set<string>();
  for (const d of out.drafts) {
    const e = emails[Number(d.email)];
    if (!e) continue;
    const to = e.direction === 'in' ? firstAddress(e.from) : firstAddress(e.to);
    if (!to || to === mailbox || done.has(to)) continue;
    done.add(to);

    const attachments: Array<{ filename: string; content: Buffer }> = [];
    let size = 0;
    for (const id of (d.attach ?? []) as string[]) {
      const doc = docs.find((x) => x.id === id);
      const file = doc ? await downloadDoc(doc as any) : null;
      if (file && size + file.content.length <= ATTACH_LIMIT) {
        attachments.push(file);
        size += file.content.length;
      }
    }

    if (dryRun) {
      lines.push(
        `[preview] draft to ${to} in "${e.subject}" — ${d.about}` +
          (attachments.length ? ` — attach: ${attachments.map((a) => a.filename).join(', ')}` : '') +
          `\n${String(d.body ?? '').trim()}\n\nKind regards,\n${DRAFT_SIGNATURE}`,
      );
      continue;
    }
    const body = `${String(d.body ?? '').replace(/\n*(kind regards|best regards|regards)[,.]?\s*$/i, '').trim()}\n\nKind regards,\n${DRAFT_SIGNATURE}`;
    const subject = /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`;
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail({
      from: process.env.SMTP_USER,
      to,
      subject,
      text: body,
      attachments,
      inReplyTo: e.messageId!,
      references: [e.messageId!],
    });
    const saved = await appendDraft(built.message as Buffer);
    if (!saved.ok) {
      lines.push(`⚠️ Could not save the draft to ${to}: ${saved.error}`);
      continue;
    }
    await logAiAction({
      source: 'task',
      summary: `Draft saved in Gmail to ${e.organisation ?? to}: ${d.about}`,
      reason: `Request "${String(task.taskType ?? '').trim()}" by ${task.authorName ?? 'staff'}: "${note}"`,
      studentId: task.studentId,
      studentName: s.name ?? null,
      undo: { type: 'none' },
    });
    lines.push(
      `✉️ Draft ready in Gmail to ${e.organisation ?? to} ("${subject}"): ${d.about}` +
        (attachments.length ? ` — attached: ${attachments.map((a) => a.filename).join(', ')}` : '') +
        '. Check it in Drafts and send.',
    );
    await replyWithReceipt(
      { uid: 0, messageId: e.messageId, from: to, fromName: e.organisation ?? '', subject: e.subject, date: e.date, text: '', attachments: [] },
      {
        kind: 'drafted',
        studentId: task.studentId,
        studentName: s.name,
        to,
        answered: [`Request "${task.taskType}" by ${task.authorName ?? 'staff'}: ${d.about}`],
        attachments: attachments.map((a) => a.filename),
        stillWaiting: [],
      },
    ).catch(() => undefined);
  }
  return lines.length ? lines : ['⚠️ No draft made — the conversations found were not with a company.'];
}

// --------------------------------------------------------------------------

export async function automateTask(taskId: string): Promise<TaskAutomationResult> {
  const base: TaskAutomationResult = { taskId, kind: null, status: 'skipped', lines: [] };
  if (!isAiConfigured() || !adminDb) return base;
  const settings = (await db().collection('app_settings').doc('email_intake').get()).data() ?? {};
  let task: Record<string, any> | null = null;
  try {
    const peek = (await db().collection('tasks').doc(taskId).get()).data();
    if (!peek || peek.category !== 'request') return base;
    const kind = kindOf(peek);
    if (!kind) return base;
    if (kind === 'add_schools' && settings.taskAddSchools === false) return { ...base, kind };
    if (kind === 'update_request' && settings.taskUpdateDrafts === false) return { ...base, kind };

    task = await claim(taskId);
    if (!task) return { ...base, kind }; // already handled
    const lines = kind === 'add_schools' ? await addSchools(task) : await draftUpdate(task);
    const result: TaskAutomationResult = { taskId, kind, status: 'done', lines };
    await finish(taskId, result);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const result: TaskAutomationResult = { taskId, kind: task ? kindOf(task) : null, status: 'error', lines: [`⚠️ Automation failed: ${msg}`] };
    if (task) await finish(taskId, result).catch(() => undefined);
    return result;
  }
}

/** What would happen for a task, without changing or creating anything. */
export async function previewTask(taskId: string): Promise<TaskAutomationResult> {
  const t = (await db().collection('tasks').doc(taskId).get()).data();
  if (!t) return { taskId, kind: null, status: 'skipped', lines: ['task not found'] };
  const task = { id: taskId, ...t };
  const kind = kindOf(task);
  if (!kind) return { taskId, kind, status: 'skipped', lines: ['not an add-school or update request'] };
  const lines = kind === 'add_schools' ? await addSchools(task, true) : await draftUpdate(task, true);
  return { taskId, kind, status: 'done', lines };
}

/** Catch requests created while nobody's browser triggered them (cron). */
export async function automateRecentTasks(limit = 6) {
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const snap = await db().collection('tasks').where('createdAt', '>=', since).get();
  const pending = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Record<string, any>)
    .filter((t) => t.category === 'request' && !t.aiAutomation && kindOf(t));
  const results: TaskAutomationResult[] = [];
  for (const t of pending.slice(0, limit)) results.push(await automateTask(t.id));
  return { found: pending.length, processed: results.length, results };
}
