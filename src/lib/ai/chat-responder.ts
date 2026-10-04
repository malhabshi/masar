// Internal-chat AI responder.
//
// Reads a student's internal chat thread after a new message arrives, decides whether it
// can usefully help, and if so replies in the thread and/or creates a task from what an
// employee asked for.
//
// Guard rails, in order of application:
//   1. Master switch (app_settings/ai_chat_responder.enabled) — OFF by default.
//   2. observeOnly — drafts the reply into ai_chat_log but posts nothing. ON by default.
//   3. Loop guard — never reacts to its own messages.
//   4. Duplicate guard — never replies twice to the same incoming message.
//   5. Muted students are skipped.
//   6. Triage gate — messages that plainly need no answer never reach the model.
// Every run is recorded in ai_chat_log, including the runs where it chose to stay quiet.

import type Anthropic from '@anthropic-ai/sdk';
import { adminDb } from '@/lib/firebase/admin';
import { runAgent } from './agent';
import type { AiTool, ToolContext } from './tools';
import {
  CHAT_BOT_NAME,
  CHAT_BOT_USER_ID,
  ensureChatBotUser,
  getResponderSettings,
} from './chat-bot';
import { AI_DOC_MODEL, isAiConfigured } from './config';
import { automaticAiAllowed } from './usage';
import { countRecords } from './count';
import { getWorkGuide, WORK_GUIDE_TOPICS } from './knowledge';
import { getStudentDocumentCards } from './documents';
import { backfillStudentEmails, emailHistoryLoaded, getStudentEmailTimeline } from '@/lib/email/memory';
import { deadlinesFor } from './deadlines';
import { EMAIL_REQUESTS_COLLECTION } from '@/lib/email/requests';
import { adminDb as db } from '@/lib/firebase/admin';
import { getStudent, getStudentChat, listRequestTypes } from '@/lib/mcp/query-tools';
import { createStudentTask, sendChatMessage, setStudentFinalChoice, updateApplicationStatus } from '@/lib/actions';
import { trustedRole } from '@/lib/auth/trusted-role';
import { FOLLOWUP_COLLECTION, followUpStopped, stopFollowUpWithUndo } from '@/lib/email/followups';
import { sameUniversity } from '@/lib/email/universities';
import { applyPastEmail } from '@/lib/email/past-email';
import { updateStudentIdentity } from '@/lib/students/identity';
import { logAiAction } from './action-log';
import type { Application, ApplicationStatus, User } from '@/lib/types';

export const AI_CHAT_LOG_COLLECTION = 'ai_chat_log';

/** How much of the thread the model sees. */
const THREAD_WINDOW = 30;

export type ResponderOutcome = {
  studentId: string;
  /** What actually happened, for logging and for the caller. */
  status: 'disabled' | 'muted' | 'no_new_message' | 'already_replied' | 'silent' | 'replied' | 'error';
  reason?: string;
  reply?: string;
  /** True when a reply was drafted but withheld because observeOnly is on. */
  drafted?: boolean;
  tasksCreated?: Array<{ requestTypeId: string; description: string; ok: boolean; message?: string }>;
  usage?: { inputTokens: number; outputTokens: number };
  /** Who the reply was addressed to. */
  replyTo?: string;
};

type ChatMessage = {
  id: string;
  authorId: string;
  content?: string;
  timestamp?: string;
  recipientLabel?: string;
  targetUserIds?: string[];
  document?: { name: string; url: string };
};

type CreatedTask = { requestTypeId: string; description: string; ok: boolean; message?: string };

/** Mutable state the tool handlers write into during a run. */
type ResponderState = {
  reply?: string;
  silentReason?: string;
  tasks: CreatedTask[];
  /** Staff asked for something and it was done (stop_follow_up): the reply is posted even in observe-only mode. */
  acted?: boolean;
  /** Who the reply was addressed to. */
  replyTo?: string;
};

async function log(entry: Record<string, unknown>): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection(AI_CHAT_LOG_COLLECTION).add({ ...entry, createdAt: new Date().toISOString() });
  } catch (e) {
    console.error('[chat-responder] Failed to write ai_chat_log:', e);
  }
}

/**
 * Atomically claim a chat message for processing. Returns false if another run already
 * claimed it, which makes duplicate triggers harmless.
 */
async function claimMessage(studentId: string, messageId: string): Promise<boolean> {
  if (!adminDb) return false;
  const ref = adminDb.collection('ai_chat_state').doc(studentId);
  try {
    return await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      // Every processed message is remembered (the last 50), not only the newest: a request
      // can be answered after a later message (the sender's browser names it), and a repeated
      // call for it must not run it twice.
      const done = (snap.data()?.processedIds ?? []) as string[];
      if (snap.exists && (snap.data()?.lastProcessedMessageId === messageId || done.includes(messageId))) return false;
      tx.set(
        ref,
        { lastProcessedMessageId: messageId, processedIds: [...done, messageId].slice(-50), claimedAt: new Date().toISOString() },
        { merge: true },
      );
      return true;
    });
  } catch (e) {
    console.error('[chat-responder] claim failed:', e);
    return false;
  }
}

/** Resolve the display names/roles of everyone who appears in the thread. */
async function resolveAuthors(ids: string[]): Promise<Map<string, { name: string; role: string }>> {
  const out = new Map<string, { name: string; role: string }>();
  if (!adminDb || ids.length === 0) return out;
  const unique = Array.from(new Set(ids));
  const snaps = await Promise.all(
    unique.map((id) => adminDb!.collection('users').doc(id).get().catch(() => null)),
  );
  snaps.forEach((snap, i) => {
    if (snap?.exists) {
      const u = snap.data() as User;
      out.set(unique[i], { name: u.name ?? 'Unknown', role: u.role ?? 'staff' });
    } else {
      out.set(unique[i], { name: 'Unknown user', role: 'unknown' });
    }
  });
  return out;
}

const SYSTEM = `You are ${CHAT_BOT_NAME}, an assistant that sits inside the internal staff chat of masar, a Kuwaiti study-abroad agency. The chat is between STAFF about a student — the student themselves cannot see it.

Your job is to help when you genuinely can, and otherwise to stay quiet.

## "شنو صار عليه؟" — status questions
"شنو صار عليه / عليها؟", "وش صار", "شصار", "any update?", "what's the status?" — someone wants to know where the student stands. You MUST answer (post_reply), never stay silent. Call \`get_student_status\` first; it has everything in one place. Answer in the language of the question, in 2–5 short lines:
- each application that is still alive (not Rejected): university — status, and the latest news with its date (from the emails);
- what is pending and on whom (missing items, a document a university is waiting for, a reply the agency owes);
- a deadline coming up, if there is one.
Leave out Rejected applications unless the question is about them. If the record has nothing new, say so plainly and say who would know (the department handling it, or the assigned employee). Never invent progress.

## When you are addressed directly
If the newest message was sent to ${CHAT_BOT_NAME} or mentions you ("@ai", "Masar AI"), someone is waiting on you: you MUST call \`post_reply\`, never \`stay_silent\`. Only \`post_reply\` reaches the chat — an answer written as plain text is never seen. If you cannot find the answer, say exactly what you could not find and who would know (usually the assigned employee or the department).

## Otherwise, staying quiet is the normal outcome
Most messages do not need you. Call \`stay_silent\` when:
- Staff are talking to each other and no question is directed at the system.
- The message is social, an acknowledgement ("ok", "done", "thanks"), or an update with no request.
- Answering would need information you cannot look up.
- A human has already answered it.
- You are not confident. Silence is always safer than a wrong answer in a shared staff channel.

## Speak when you can actually help
Call \`post_reply\` when:
- Someone asks a factual question you can answer from the student's record (their applications, statuses, documents, assigned employee, IELTS score, deadlines).
- Someone asks what happened by email ("did they reply", "did we send it") — use \`get_student_emails\`.
- Someone asks what a document says (is the offer conditional, the deposit deadline, the IELTS bands) — use \`get_student_documents\`.
- Someone asks how the agency does something — read \`get_work_guide\` and answer from it. The team's notes in it override everything else.
- Someone asks "how many" — use \`count_records\`, never guess, and say what you counted.
- Someone asks for something that should become a task — create the task first, then say plainly what you created.
- There is a clear, checkable error worth flagging.

## Who sees your reply
By default your reply is addressed to whoever wrote to you. When staff ask you to tell, inform, notify or pass something on to the assigned employee ("الموظف المسؤول", "the employee", or the employee's name), set \`to\` in post_reply to "assigned_employee" — or "sender_and_employee" if the person asking should see it as well. For the admins or the departments use "admins" or "departments". Write the message itself for the people it is addressed to. Refer to people by name, never by civil ID.

## Stopping a follow-up
Your ⏳ messages say an email asking for an update on an application is waiting in Gmail Drafts. When staff tell you to stop chasing one — the student is going with another school, has withdrawn, or simply "don't follow up" — call \`stop_follow_up\` for that application (reason chose_other_school, withdrawn or just_stop), then post_reply saying what you did, and that the draft waiting in Gmail Drafts should be deleted (you never delete email). If it is not clear which application they mean, ask.

## Fixing the record
Admins and departments can have you fix a student's applications, as they can on the site. When they ask you to change an application's status or attach a letter that came by email — or point out an email that holds an offer or a rejection the record does not show (for example, when your ⏳ follow-up was wrong) — find that email with \`get_student_emails\` and call \`apply_email\` with its ref: it files the email's attachments on the profile and applies the offer or rejection. For a status change with no email behind it, call \`set_application_status\`. When staff tell you which school the student is going with, call \`set_final_choice\` (the assigned employee may ask for this too): from then on only that school is chased, so the others' follow-ups stop by themselves — no stop_follow_up needed — but say which update requests are already waiting in Gmail Drafts for the other schools, for staff to delete. When staff ask you to fill in or correct the student's name, date of birth or civil ID (the fields at the top of the profile; the record keeps the last two as jotformData.dob and jotformData.civilId), call \`set_student_details\` (the assigned employee may ask too). Use the values staff gave, or read them from the documents with \`get_student_documents\`: the date of birth from the passport; the civil ID only from a civil ID card or a number staff gave you — a number on a school certificate is not proof of it. If the tool says the civil ID does not match the date of birth or is on another student, tell staff and ask them to confirm; pass confirmed only after they do. Then post_reply saying exactly what changed. If the tool refuses, say why. You never delete email: when a Gmail draft should go, say so and leave it to staff.

## Creating tasks
When an employee asks for something that matches one of the request types listed below, call \`create_task\` with the matching requestTypeId and a clear description quoting what they asked for. Then reply in the chat saying what you created. If nothing matches well, do not invent a task — reply asking which request type they want, or stay silent.

## How to write
- Short. One or two sentences. This is a busy work chat, not a report.
- Plain and direct. No greetings, no sign-offs, no "I hope this helps".
- Staff write in a mix of English and Arabic. Reply in the language the message used.
- Never guess a fact. If you did not read it from the student record, do not state it.
- Never claim you did something unless the tool told you it succeeded.`;

/** The one application staff mean: exact name, then the same distinctive words; a course they name must match. */
function findApplication(apps: Application[], university: unknown, major: unknown): { app: Application } | { error: string } {
  const name = String(university ?? '').trim();
  const course = typeof major === 'string' ? major.trim().toLowerCase() : '';
  let hits = apps.filter((a) => a.university.trim().toLowerCase() === name.toLowerCase());
  if (!hits.length) hits = apps.filter((a) => sameUniversity(a.university, name));
  // A course named by staff must match, even when only one application is at that university.
  if (course) hits = hits.filter((a) => a.major.toLowerCase().includes(course) || course.includes(a.major.toLowerCase()));
  if (hits.length === 1) return { app: hits[0] };
  return {
    error: hits.length
      ? `Several applications match: ${hits.map((a) => `${a.university} (${a.major})`).join('; ')}. Ask which one.`
      : `No application "${name}" on this student. Their applications: ${apps.map((a) => a.university).join('; ')}.`,
  };
}

function buildToolset(opts: {
  studentId: string;
  allowTaskCreation: boolean;
  observeOnly: boolean;
  notifyUserIds: string[];
  collected: ResponderState;
  /** The newest message was sent to the bot or mentions it — only then may it act. */
  addressed: boolean;
  /** Preview: work out what would happen, change nothing. */
  preview: boolean;
  /** Who asked, for the records. */
  requestedBy: string;
  /** The student's assigned employee (resolved from the civil ID), if any. */
  employee: { id: string; name: string } | null;
  /** The user id of whoever wrote the newest message — checked before anything is changed. */
  requesterId: string;
  /**
   * The newest message is the one the caller's browser just sent, and the caller (proven
   * by their login) is its author. A message's author field alone can be forged, so
   * nothing is changed without this.
   */
  requesterVerified: boolean;
}): AiTool[] {
  const { studentId, allowTaskCreation, observeOnly, notifyUserIds, collected, addressed, preview, requestedBy, requesterId, requesterVerified, employee } = opts;

  const tools: AiTool[] = [
    {
      write: false,
      definition: {
        name: 'get_student_record',
        description:
          'Fetch the full record for the student this chat is about — applications and their ' +
          'statuses, documents, notes, checklist state. Use it before answering any factual question.',
        input_schema: { type: 'object', properties: {} },
      },
      handler: async () => (await getStudent(studentId)) ?? { error: 'Student not found.' },
    },
    {
      write: false,
      definition: {
        name: 'stay_silent',
        description:
          'End without posting anything. This is the correct choice for most messages. Give the ' +
          'reason you decided not to speak — it is recorded for review, not shown in the chat.',
        input_schema: {
          type: 'object',
          properties: { reason: { type: 'string' } },
          required: ['reason'],
        },
      },
      handler: async (input) => {
        collected.silentReason = String(input.reason ?? 'no reason given');
        return { ok: true, note: 'Staying silent. Stop now and produce no further tool calls.' };
      },
    },
    {
      write: false,
      definition: {
        name: 'post_reply',
        description:
          'Post a message into this student\'s internal staff chat, as ' +
          `${CHAT_BOT_NAME}. Keep it to one or two sentences. Call this at most once.`,
        input_schema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The message text.' },
            to: {
              type: 'string',
              enum: ['sender', 'assigned_employee', 'sender_and_employee', 'admins', 'departments'],
              description: 'Who the message is addressed to (they are notified). Default: the person who wrote to you.',
            },
          },
          required: ['content'],
        },
      },
      handler: async () => ({ ok: false, error: 'replaced below' }),
    },
  ];

  tools.push(
    {
      write: false,
      definition: {
        name: 'get_student_status',
        description:
          "Everything about where this student stands, in one call: each application with its status and when it " +
          'last changed, the final choice, the latest emails with universities and agents (what they said and asked), ' +
          'what is still waiting (missing items, documents a university asked for), change agent, and upcoming ' +
          'deadlines. Use it first for any "what happened / any update / status" question.',
        input_schema: { type: 'object', properties: {} },
      },
      handler: () => studentStatus(studentId),
    },
    {
      write: false,
      definition: {
        name: 'get_student_documents',
        description:
          "What this student's documents say: each file's type, a one-line summary and the facts " +
          'read from it (offer type and conditions, deposit, deadlines, IELTS bands, grades, ' +
          'passport expiry). Use it for any question about an offer, CAS, IELTS or other document.',
        input_schema: { type: 'object', properties: {} },
      },
      handler: () => getStudentDocumentCards(studentId),
    },
    {
      write: false,
      definition: {
        name: 'get_student_emails',
        description:
          "This student's email history with universities, agents, the KCO and the family, newest " +
          'first, one line each. Use it for questions like "did the university reply", "did we send the passport".',
        input_schema: { type: 'object', properties: { filter: { type: 'string' } } },
      },
      handler: (input) => getStudentEmailTimeline(studentId, { filter: input.filter, limit: 30 }),
    },
    {
      write: false,
      definition: {
        name: 'get_work_guide',
        description:
          "How the agency works: roles, student lifecycle, pipeline colours, applications, " +
          'checklists, chat and notes, tasks and request types, JotForm, universities — plus ' +
          "live settings and the team's own notes, which override the rest.",
        input_schema: {
          type: 'object',
          properties: { topic: { type: 'string', enum: WORK_GUIDE_TOPICS } },
        },
      },
      handler: (input) => getWorkGuide(input.topic),
    },
    {
      write: false,
      definition: {
        name: 'count_records',
        description:
          'Exact count of students, applications or tasks. Closed students are excluded by default. ' +
          'filters: employeeId (civil ID), pipelineStatus, country, applicationStatus, university, ' +
          'major, studyLevel, intakeYear, from/to (ISO dates), taskStatus, taskType. groupBy: ' +
          'employee, country, applicationStatus, university, pipelineStatus, studyLevel, month, taskType, taskStatus.',
        input_schema: {
          type: 'object',
          properties: {
            entity: { type: 'string', enum: ['students', 'applications', 'tasks'] },
            filters: { type: 'object' },
            groupBy: { type: 'string' },
          },
          required: ['entity'],
        },
      },
      handler: (input) => countRecords({ entity: input.entity, filters: input.filters, groupBy: input.groupBy }),
    },
  );

  // post_reply needs the real implementation, wired here so it can capture state.
  tools[2].handler = async (input) => {
    const content = String(input.content ?? '').trim();
    if (!content) return { ok: false, error: 'Reply content was empty; nothing posted.' };
    if (collected.reply) {
      return { ok: false, error: 'You have already replied in this run. Do not post again.' };
    }
    collected.reply = content;

    // Who it is addressed to — and so notified.
    const to = String(input.to ?? 'sender');
    let recipients = notifyUserIds;
    let toLabel = requestedBy;
    if (to === 'assigned_employee' || to === 'sender_and_employee') {
      if (!employee) {
        recipients = to === 'sender_and_employee' ? [...notifyUserIds, 'admins'] : ['admins'];
        toLabel = 'the admins (this student has no assigned employee)';
      } else {
        recipients = to === 'sender_and_employee' ? [...new Set([...notifyUserIds, employee.id])] : [employee.id];
        toLabel = to === 'sender_and_employee' ? `${requestedBy} and ${employee.name}` : employee.name;
      }
    } else if (to === 'admins' || to === 'departments') {
      recipients = [to];
      toLabel = to;
    }
    collected.replyTo = toLabel;

    // Observe-only holds back the AI's own answers. A confirmation of something staff asked
    // for and the AI did (stop_follow_up) is posted regardless — they are waiting for it.
    if (observeOnly && !collected.acted) {
      return {
        ok: true,
        posted: false,
        note: 'Observe-only mode is on: the reply was recorded for review but NOT posted to the chat.',
      };
    }

    const result = await sendChatMessage(studentId, CHAT_BOT_USER_ID, content, recipients);
    return result.success
      ? { ok: true, posted: true, addressedTo: toLabel }
      : { ok: false, error: result.message ?? 'Failed to post the message.' };
  };

  tools.push({
    write: false,
    definition: {
      name: 'stop_follow_up',
      description:
        "Stop chasing one of this student's applications for an offer, when staff tell you to — usually in reply to your " +
        '⏳ follow-up message: the student is going with another school, has withdrawn, or it should not be chased. With ' +
        'reason chose_other_school or withdrawn the application is also set to Rejected with that reason (unless it is ' +
        'already Accepted or Rejected). Give the university exactly as it appears in the applications list.',
      input_schema: {
        type: 'object',
        properties: {
          university: { type: 'string' },
          major: { type: 'string', description: 'Only needed when the student has two applications at that university.' },
          reason: { type: 'string', enum: ['chose_other_school', 'withdrawn', 'just_stop'] },
          note: { type: 'string', description: 'What staff said, in a few words.' },
        },
        required: ['university', 'reason'],
      },
    },
    handler: async (input) => {
      if (!addressed) return { ok: false, error: 'Only when staff ask you directly (@ai, or sent to Masar AI).' };
      if (!requesterVerified) {
        return { ok: false, error: 'Not changed: I can only act on a request sent from masar by the person who wrote it. Ask them to send it again.' };
      }
      if (!db) return { ok: false, error: 'Database not available.' };
      const s = (await db.collection('students').doc(studentId).get()).data();
      if (!s) return { ok: false, error: 'Student not found.' };
      // Anyone signed in can write in a chat; only staff responsible for this student may
      // have the AI change it: admins, admin plus and departments, or the assigned employee.
      const role = await trustedRole(requesterId);
      const assigned =
        role === 'employee' &&
        !!s.employeeId &&
        (await db.collection('users').doc(requesterId).get()).data()?.civilId === s.employeeId;
      if (!(role === 'admin' || role === 'adminplus' || role === 'department' || assigned)) {
        return { ok: false, error: "Not changed: only admins, departments or this student's own employee can ask for this." };
      }
      const found = findApplication((s.applications ?? []) as Application[], input.university, input.major);
      if ('error' in found) return { ok: false, error: found.error };
      const app = found.app;
      const reason = ['chose_other_school', 'withdrawn', 'just_stop'].includes(input.reason) ? String(input.reason) : 'just_stop';
      const rejectionReason =
        reason === 'chose_other_school' ? 'Student chose another university' : reason === 'withdrawn' ? 'Withdrawn by the student' : null;
      const reject = !!rejectionReason && app.status !== 'Accepted' && app.status !== 'Rejected';
      if (preview) return { ok: true, preview: true, wouldStop: `${app.university} (${app.major})`, wouldSetRejected: reject };

      const said = String(input.note ?? '').slice(0, 200);
      // The stop, the rejection and the AI Activity entry (with Undo) are saved together.
      const r = await stopFollowUpWithUndo({
        studentId,
        university: app.university,
        major: app.major,
        rejectionReason,
        stopReason: said || reason,
        by: requestedBy,
        logReason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
      });
      if (!r.ok) return { ok: false, error: `Not changed: ${r.error}` };
      const status = r.status;
      const draft = r.draft;
      collected.acted = true;
      return {
        ok: true,
        followUpsStopped: `${app.university} (${app.major})`,
        status,
        draftToDelete: draft.lastDraftedAt
          ? `The update request to ${draft.to} drafted on ${draft.lastDraftedAt.slice(0, 10)} is still in Gmail Drafts — tell staff to delete it (you never delete email).`
          : 'No follow-up draft on record.',
      };
    },
  });

  /**
   * As on the site: only admins, admin plus and departments change statuses and file
   * documents. The final choice may also be set by the student's own employee.
   */
  const refuseRecordChange = async (opts: { assignedEmployee?: boolean; what?: string } = {}): Promise<string | null> => {
    if (!addressed) return 'Only when staff ask you directly (@ai, or sent to Masar AI).';
    if (!requesterVerified) return 'Not changed: I can only act on a request sent from masar by the person who wrote it. Ask them to send it again.';
    const role = await trustedRole(requesterId);
    if (role === 'admin' || role === 'adminplus' || role === 'department') return null;
    if (opts.assignedEmployee && role === 'employee' && employee?.id === requesterId) return null;
    return opts.assignedEmployee
      ? `Not changed: only admins, departments or this student's own employee can ${opts.what ?? 'ask for this'}.`
      : 'Not changed: only admins and departments can change application statuses or file documents, the same as on the site.';
  };

  tools.push({
    write: false,
    definition: {
      name: 'apply_email',
      description:
        "Apply one of this student's emails to the profile, when admins or departments ask — usually an offer or a " +
        'rejection that came before the system read the mailbox, so its status was never set and its letter never filed. ' +
        "Files the email's attachments on the profile and applies an offer (→ Accepted) or a rejection (→ Rejected) to the " +
        'application it is about, under the usual rules. Find the email with get_student_emails and pass its ref.',
      input_schema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'The ref of the email, from get_student_emails.' },
          note: { type: 'string', description: 'What staff asked, in a few words.' },
        },
        required: ['ref'],
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange();
      if (refused) return { ok: false, error: refused };
      const said = String(input.note ?? '').slice(0, 200);
      const r = await applyPastEmail({
        studentId,
        ref: String(input.ref ?? ''),
        by: `${requestedBy} in the internal chat${said ? `: "${said}"` : ''}`,
        dryRun: preview,
      });
      if (!r.ok) return { ok: false, error: `Not changed: ${r.error}` };
      if (!preview) collected.acted = true;
      return {
        ok: true,
        ...(preview ? { preview: true } : {}),
        email: r.email,
        filedOnProfile: r.filed,
        statusChanges: r.lines.length ? r.lines : ['No status changed.'],
        alreadyCorrect: r.alreadyCorrect,
      };
    },
  });

  tools.push({
    write: false,
    definition: {
      name: 'set_application_status',
      description:
        "Change the status of one of this student's applications when admins or departments ask (\"change Leeds to " +
        'Accepted"). Give the university exactly as it appears in the applications list. Rejected needs a reason. When the ' +
        'change comes from an email, use apply_email instead, so the letter is filed too.',
      input_schema: {
        type: 'object',
        properties: {
          university: { type: 'string' },
          major: { type: 'string', description: 'Only needed when the student has two applications at that university.' },
          status: { type: 'string', enum: ['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'] },
          rejectionReason: { type: 'string', description: 'Required for Rejected.' },
          note: { type: 'string', description: 'What staff said, in a few words.' },
        },
        required: ['university', 'status'],
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange();
      if (refused) return { ok: false, error: refused };
      if (!db) return { ok: false, error: 'Database not available.' };
      const s = (await db.collection('students').doc(studentId).get()).data();
      if (!s) return { ok: false, error: 'Student not found.' };
      const found = findApplication((s.applications ?? []) as Application[], input.university, input.major);
      if ('error' in found) return { ok: false, error: found.error };
      const app = found.app;
      const to = String(input.status) as ApplicationStatus;
      if (!['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'].includes(to)) return { ok: false, error: `Unknown status "${to}".` };
      const reason = String(input.rejectionReason ?? '').trim().slice(0, 200);
      if (to === 'Rejected' && !reason) return { ok: false, error: 'Not changed: Rejected needs a reason — ask for it.' };
      if (app.status === to) return { ok: true, unchanged: `${app.university} (${app.major}) is already ${to}.` };
      if (preview) return { ok: true, preview: true, wouldSet: `${app.university} (${app.major}): ${app.status} → ${to}` };

      const r = await updateApplicationStatus(studentId, app.university, app.major, to, s.name, s.employeeId ?? null, to === 'Rejected' ? reason : undefined);
      if (!r.success) return { ok: false, error: `Not changed: ${r.message}` };
      const said = String(input.note ?? '').slice(0, 200);
      await logAiAction({
        source: 'chat',
        summary: `${app.university}: ${app.status} → ${to}${to === 'Rejected' ? ` (${reason})` : ''}`,
        reason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
        studentId,
        studentName: s.name ?? null,
        undo: { type: 'app_status', university: app.university, major: app.major, from: app.status, to, rejectionReason: app.rejectionReason ?? null },
      });
      collected.acted = true;
      return { ok: true, changed: `${app.university} (${app.major}): ${app.status} → ${to}`, employeeNotified: !!s.employeeId };
    },
  });

  tools.push({
    write: false,
    definition: {
      name: 'set_student_details',
      description:
        "Fill in or correct the student's name, date of birth or civil ID — the fields at the top of the profile — when " +
        'staff ask. Give only the fields to change. The civil ID is checked against the birth date it encodes and against ' +
        'other students; set confirmed only when staff have confirmed it after such a warning.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The full name as it should appear, e.g. from the passport.' },
          dob: { type: 'string', description: 'Date of birth, YYYY-MM-DD.' },
          civilId: { type: 'string', description: '12 digits.' },
          confirmed: { type: 'boolean', description: 'Staff confirmed the civil ID after a warning.' },
          note: { type: 'string', description: 'What staff asked, in a few words.' },
        },
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange({ assignedEmployee: true, what: 'change these details' });
      if (refused) return { ok: false, error: refused };
      const r = await updateStudentIdentity({
        studentId,
        fields: { name: input.name, dob: input.dob, civilId: input.civilId },
        by: { id: requesterId, name: requestedBy },
        confirmed: input.confirmed === true,
        dryRun: preview,
      });
      if (!r.ok) return { ok: false, error: r.error };
      if (preview) return { ok: true, preview: true, wouldChange: r.changes.map((c) => `${c.label}: ${c.from ?? '(empty)'} → ${c.to}`), unchanged: r.unchanged };
      const said = String(input.note ?? '').slice(0, 200);
      const studentName = (await db?.collection('students').doc(studentId).get())?.data()?.name ?? null;
      for (const c of r.changes) {
        await logAiAction({
          source: 'chat',
          summary: `${c.label[0].toUpperCase()}${c.label.slice(1)}: ${c.from ?? '(empty)'} → ${c.to}`,
          reason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
          studentId,
          studentName,
          undo: { type: 'set_field', field: c.path, from: c.from, to: c.to },
        });
      }
      if (r.changes.length) collected.acted = true;
      return { ok: true, changed: r.changes.map((c) => `${c.label}: ${c.from ?? '(empty)'} → ${c.to}`), unchanged: r.unchanged };
    },
  });

  tools.push({
    write: false,
    definition: {
      name: 'set_final_choice',
      description:
        "Set the student's final choice — the school they are going with — when staff ask (\"he is going with Sheffield\", " +
        '"change the final choice to Sheffield"). Give the university exactly as it appears in the applications list. Only ' +
        'the final choice is chased for an offer from then on.',
      input_schema: {
        type: 'object',
        properties: {
          university: { type: 'string' },
          major: { type: 'string', description: 'Only needed when the student has two applications at that university.' },
          note: { type: 'string', description: 'What staff said, in a few words.' },
        },
        required: ['university'],
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange({ assignedEmployee: true, what: 'set the final choice' });
      if (refused) return { ok: false, error: refused };
      if (!db) return { ok: false, error: 'Database not available.' };
      const s = (await db.collection('students').doc(studentId).get()).data();
      if (!s) return { ok: false, error: 'Student not found.' };
      const found = findApplication((s.applications ?? []) as Application[], input.university, input.major);
      if ('error' in found) return { ok: false, error: found.error };
      const app = found.app;
      const before: string | null = s.finalChoiceUniversity ?? null;
      // Drafts already waiting for the other schools: staff delete those, the AI never does.
      const waiting = (await db.collection(FOLLOWUP_COLLECTION).where('studentId', '==', studentId).get()).docs
        .map((d) => d.data())
        .filter((f) => f.lastDraftedAt && f.university !== app.university && !followUpStopped(f))
        .map((f) => `${f.university}: update request to ${f.to} drafted ${String(f.lastDraftedAt).slice(0, 10)}`);
      if (before === app.university) {
        return { ok: true, unchanged: `The final choice is already ${app.university}.`, draftsForOtherSchools: waiting };
      }
      if (preview) return { ok: true, preview: true, wouldSet: `${before ?? '(none)'} → ${app.university}`, draftsForOtherSchools: waiting };

      // The site's own action: the note in the requester's name, and admins told when an employee sets it.
      const r = await setStudentFinalChoice(studentId, app.university, app.major, requesterId);
      if (!r.success) return { ok: false, error: `Not changed: ${r.message}` };
      const said = String(input.note ?? '').slice(0, 200);
      await logAiAction({
        source: 'chat',
        summary: `Final choice: ${before ?? '(none)'} → ${app.university}`,
        reason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
        studentId,
        studentName: s.name ?? null,
        undo: { type: 'set_field', field: 'finalChoiceUniversity', from: before, to: app.university },
      });
      collected.acted = true;
      return {
        ok: true,
        finalChoice: `${before ?? '(none)'} → ${app.university}`,
        followUps: `Only ${app.university} is chased from now on.`,
        draftsForOtherSchools: waiting.length ? waiting : 'None waiting.',
      };
    },
  });

  if (allowTaskCreation) {
    tools.push({
      write: false,
      definition: {
        name: 'create_task',
        description:
          'Create a task/request for this student from what an employee asked for in the chat. ' +
          'Use one of the requestTypeId values listed in the conversation. After creating it, ' +
          'post_reply to say what you created.',
        input_schema: {
          type: 'object',
          properties: {
            requestTypeId: { type: 'string', description: 'Must be one of the listed request type ids.' },
            description: {
              type: 'string',
              description: 'What is being requested, quoting the employee where useful.',
            },
          },
          required: ['requestTypeId', 'description'],
        },
      },
      handler: async (input) => {
        const requestTypeId = String(input.requestTypeId ?? '');
        const description = String(input.description ?? '');
        if (observeOnly) {
          collected.tasks.push({ requestTypeId, description, ok: true, message: 'observe-only: not created' });
          return {
            ok: true,
            created: false,
            note: 'Observe-only mode is on: the task was recorded for review but NOT created.',
          };
        }
        const result = await createStudentTask(CHAT_BOT_USER_ID, studentId, requestTypeId, description);
        collected.tasks.push({
          requestTypeId,
          description,
          ok: result.success === true,
          message: result.message,
        });
        return result.success
          ? { ok: true, created: true }
          : { ok: false, error: result.message ?? 'Task creation failed.' };
      },
    });
  }

  return tools;
}

/**
 * Pure acknowledgements, in the two languages the staff chat actually uses. Matched
 * against the whole message, so "ok" is caught but "ok what about the UCL offer" is not.
 */
const ACKNOWLEDGEMENT =
  /^(ok(ay)?|k+|done|thx|thanks?|thank you|ty|noted|sure|yes|yeah|yep|no|nope|got it|fine|great|perfect|تم|تمام|شكرا|شكرا جزيلا|اوك|أوك|ماشي|تسلم|زين)[\s.!،]*$/i;

/**
 * Cheap triage before any tokens are spent. The responder fires on every message posted
 * to a student thread, and the overwhelming majority of those are staff talking to each
 * other — a full agent run only to conclude stay_silent. Deliberately conservative: an
 * attachment, a question mark, or any message of real length always reaches the model.
 */
/** One digest of where a student stands — for status questions. */
async function studentStatus(studentId: string) {
  if (!db) return { error: 'Database not available' };
  const snap = await db.collection('students').doc(studentId).get();
  const s = snap.data();
  if (!s) return { error: 'Student not found.' };
  let emails = await getStudentEmailTimeline(studentId, { limit: 8 });
  // Older mail never loaded for this student: fill the memory from the mailbox once.
  if (!(await emailHistoryLoaded(studentId))) {
    await backfillStudentEmails(studentId, { limit: 60 }).catch(() => undefined);
    emails = await getStudentEmailTimeline(studentId, { limit: 8 });
  }
  const waiting = (await db.collection(EMAIL_REQUESTS_COLLECTION).where('studentId', '==', studentId).get()).docs
    .map((d) => d.data())
    .filter((r) => r.status === 'waiting')
    .flatMap((r) =>
      (r.items ?? [])
        .filter((it: { status: string }) => it.status === 'waiting')
        .map((it: { text: string }) => `${it.text} — asked by ${r.organisation ?? r.replyTo} on ${String(r.receivedAt).slice(0, 10)}`),
    );
  return {
    name: s.name,
    finalChoice: s.finalChoiceUniversity ?? null,
    applications: (s.applications ?? []).map((a: { university: string; major: string; status: string; updatedAt?: string; rejectionReason?: string }) => ({
      university: a.university,
      major: a.major,
      status: a.status,
      since: String(a.updatedAt ?? '').slice(0, 10) || null,
      ...(a.rejectionReason ? { rejectionReason: a.rejectionReason } : {}),
    })),
    latestEmails: emails.timeline,
    missingItems: ((s.missingItems ?? []) as Array<string | { text?: string }>).map((m) => (typeof m === 'string' ? m : m.text)),
    documentsUniversitiesAreWaitingFor: waiting,
    changeAgent: s.changeAgentRequired ? s.changeAgentUniversities ?? true : false,
    upcomingDeadlines: deadlinesFor(studentId, s).map((d) => `${d.date} — ${d.label}`),
    readiness: s.profileCompletionStatus ?? null,
  };
}

/** "شنو صار عليه؟", "any update?" — someone asking where the student stands. */
function asksForStatus(m: ChatMessage): boolean {
  const t = m.content ?? '';
  // "ابديت" alone is also how staff say "I did the update" — only a question counts.
  return (
    /شنو\s*صار|وش\s*صار|شصار|ايش\s*صار|شنو\s*الوضع|وين\s*وصل|any\s*update|what('?s|\s+is)?\s*(the\s*)?(status|update)/i.test(t) ||
    /(اب\s*ديت|ابديت|update|status)\s*[?؟]/i.test(t)
  );
}

/** Was this message sent to the bot, or does it call it by name? */
function addressesBot(m: ChatMessage): boolean {
  if ((m.targetUserIds ?? []).includes(CHAT_BOT_USER_ID)) return true;
  return /@ai\b|masar\s*ai|مسار\s*(ai|الذكي)/i.test(m.content ?? '');
}

function needsModel(m: ChatMessage): boolean {
  if (addressesBot(m) || asksForStatus(m)) return true;
  if (m.document) return true;
  const text = (m.content ?? '').trim();
  if (!text) return false;
  if (/[?؟]/.test(text)) return true;
  if (ACKNOWLEDGEMENT.test(text)) return false;
  // Only a message that asks for something is worth a model call. A plain statement
  // between colleagues ("sent it to Merit", "the student will come tomorrow") is not,
  // and those are most of the chat.
  return /\b(please|pls|plz|can you|could you|book|request|need|send)\b|ابي|ابغى|نبي|نبغى|ممكن|لو سمحت|حجز|احجز|ارسل|طلب/i.test(text);
}

/**
 * Examine a student's chat thread and act if useful. Never throws.
 */
export async function respondToStudentChat(
  studentId: string,
  /** Preview: treat this as the newest message, post nothing, claim and log nothing. */
  preview?: { content: string; authorId: string },
  /** From the endpoint: who called (verified login) and which message their browser just sent. */
  caller?: { verifiedCallerId?: string; verifiedMessageId?: string },
): Promise<ResponderOutcome> {
  try {
    const settings = preview
      ? { ...(await getResponderSettings()), enabled: true, observeOnly: true, allowTaskCreation: false }
      : await getResponderSettings();
    if (!settings.enabled || !isAiConfigured()) {
      return { studentId, status: 'disabled', reason: !settings.enabled ? 'responder disabled' : 'no API key' };
    }
    if (!(await automaticAiAllowed())) {
      return { studentId, status: 'disabled', reason: "this month's AI budget is used up" };
    }
    if (settings.mutedStudentIds.includes(studentId)) {
      return { studentId, status: 'muted' };
    }

    const { messages } = (await getStudentChat(studentId, THREAD_WINDOW)) as unknown as {
      messages: ChatMessage[];
    };
    if (preview) {
      messages.push({ id: 'preview', authorId: preview.authorId, content: preview.content, timestamp: new Date().toISOString() });
    }
    if (!messages.length) return { studentId, status: 'no_new_message' };

    // The sender's browser names the message it just sent. If a colleague posted right
    // after it, that message is still the one to answer — the thread is read up to it.
    if (!preview && caller?.verifiedMessageId && messages[messages.length - 1]?.id !== caller.verifiedMessageId) {
      const at = messages.findIndex((m) => m.id === caller.verifiedMessageId);
      if (at >= 0 && addressesBot(messages[at])) messages.splice(at + 1);
    }
    const last = messages[messages.length - 1];
    // Loop guard: our own message is never a trigger.
    if (last.authorId === CHAT_BOT_USER_ID) {
      return { studentId, status: 'already_replied', reason: "last message is the bot's own" };
    }

    // Triage gate. Skipped messages cost nothing — no model call, no log write — and are
    // left unclaimed, so a later edit to the thread is still free to wake the responder.
    if (!needsModel(last)) {
      return { studentId, status: 'silent', reason: 'no answer needed (pre-model triage)' };
    }

    // A request to the AI can lead it to change data, which needs the sender's own wake-up
    // call (their login, for this message). Any other trigger must not use the message up
    // first: it waits. After a few minutes without one the message is answered — but then
    // unverified, so nothing is changed.
    const verified =
      !!preview ||
      (!!caller?.verifiedCallerId && caller.verifiedCallerId === last.authorId && caller.verifiedMessageId === last.id);
    if (!verified && addressesBot(last) && Date.now() - new Date(last.timestamp ?? 0).getTime() < 3 * 60_000) {
      return { studentId, status: 'no_new_message', reason: "waiting for the sender's own request" };
    }

    // Duplicate guard. Two triggers can fire for the same message (the sender's browser
    // plus a queue drain), so claim the message id transactionally — only the first
    // caller through proceeds.
    const claimed = preview ? true : await claimMessage(studentId, last.id);
    if (!claimed) return { studentId, status: 'already_replied', reason: 'message already processed' };

    const [student, requestTypes, authors] = await Promise.all([
      getStudent(studentId),
      listRequestTypes(),
      resolveAuthors(messages.map((m) => m.authorId)),
    ]);
    if (!student) return { studentId, status: 'error', reason: 'student not found' };

    await ensureChatBotUser();

    const transcript = messages
      .map((m) => {
        const who = m.authorId === CHAT_BOT_USER_ID ? `${CHAT_BOT_NAME} (you)` : authors.get(m.authorId)?.name ?? 'Unknown';
        const role = authors.get(m.authorId)?.role ?? '';
        const doc = m.document ? ` [attached file: ${m.document.name}]` : '';
        const to = m.recipientLabel ? ` → to ${m.recipientLabel}` : '';
        return `[${m.timestamp ?? ''}] ${who}${role ? ` (${role})` : ''}${to}: ${m.content ?? ''}${doc}`;
      })
      .join('\n');

    const requestTypeList = (requestTypes.requestTypes as Array<Record<string, unknown>>)
      .map((rt) => `- ${rt.id}: ${rt.name}${rt.description ? ` — ${rt.description}` : ''}`)
      .join('\n');

    const employeeDoc = (student as any).employeeId && db
      ? (await db.collection('users').where('civilId', '==', (student as any).employeeId).limit(1).get()).docs[0]
      : undefined;
    const employee = employeeDoc ? { id: employeeDoc.id, name: String(employeeDoc.data().name ?? 'the assigned employee') } : null;

    const studentLine = [
      `Name: ${(student as any).name ?? 'unknown'}`,
      `Assigned employee: ${employee ? employee.name : 'none'}`,
      `Applications: ${((student as any).applications ?? [])
        .map((a: any) => `${a.university} (${a.country}) — ${a.status}`)
        .join('; ') || 'none'}`,
    ].join('\n');

    const userPrompt = `A new message just arrived in the internal staff chat for this student.

## Student
${studentLine}

## Request types you can create tasks from
${requestTypeList || '(none configured)'}

## Chat thread (oldest first, newest last)
${transcript}

${addressesBot(last) || asksForStatus(last)
  ? asksForStatus(last)
    ? `The newest message asks where the student stands. Call get_student_status, then answer it with post_reply.`
    : `The newest message is addressed to you. Answer it with post_reply (creating a task first if one was asked for).`
  : `The newest message is the one to react to. Decide whether to help or stay quiet, then call exactly one of stay_silent or post_reply (creating a task first if one was asked for).`}`;

    const state: ResponderState = { reply: undefined, silentReason: undefined, tasks: [] };

    // Notify only the person whose message triggered this, not the whole channel.
    const notifyUserIds = last.authorId && last.authorId !== CHAT_BOT_USER_ID ? [last.authorId] : [];

    const toolset = buildToolset({
      studentId,
      allowTaskCreation: settings.allowTaskCreation,
      observeOnly: settings.observeOnly,
      notifyUserIds,
      collected: state,
      addressed: addressesBot(last),
      preview: !!preview,
      requestedBy: authors.get(last.authorId)?.name ?? last.authorId,
      requesterId: last.authorId,
      employee,
      requesterVerified: verified,
    });

    const actor = { id: CHAT_BOT_USER_ID, name: CHAT_BOT_NAME, role: 'employee' };
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ];

    const run = await runAgent({
      messages: [{ role: 'user', content: userPrompt }],
      actor,
      allowWrites: true,
      toolset,
      system,
      maxIterations: 8,
      feature: 'chat',
      model: AI_DOC_MODEL,
      // Short replies; extended thinking only added paid output tokens.
      thinking: false,
    });

    // The model sometimes writes its answer as plain text instead of calling post_reply.
    // When someone was waiting on us, that text is the answer: post it rather than drop it.
    // Otherwise silence is the safe default, but keep the text so the log shows why.
    const looseText = run.reply?.trim();
    if (!state.reply && !state.silentReason && looseText) {
      if (addressesBot(last) || asksForStatus(last)) {
        await toolset.find((t) => t.definition.name === 'post_reply')?.handler({ content: looseText }, { actor, allowWrites: true });
      } else {
        state.silentReason = `ended without post_reply; it wrote: ${looseText.slice(0, 300)}`;
      }
    }

    const outcome: ResponderOutcome = {
      studentId,
      status: state.reply ? 'replied' : 'silent',
      reason: state.silentReason ?? run.error,
      reply: state.reply,
      replyTo: state.replyTo,
      drafted: state.reply ? settings.observeOnly && !state.acted : undefined,
      tasksCreated: state.tasks.length ? state.tasks : undefined,
      usage: { inputTokens: run.usage.inputTokens, outputTokens: run.usage.outputTokens },
    };

    if (!preview) await log({
      studentId,
      studentName: (student as any).name ?? null,
      triggeredByMessage: last.content ?? null,
      triggeredByAuthor: authors.get(last.authorId)?.name ?? last.authorId,
      status: outcome.status,
      reason: outcome.reason ?? null,
      reply: outcome.reply ?? null,
      replyTo: state.replyTo ?? null,
      observeOnly: settings.observeOnly,
      posted: outcome.status === 'replied' && (!settings.observeOnly || !!state.acted),
      tasks: state.tasks,
      usage: outcome.usage,
      agentError: run.error ?? null,
    });

    return outcome;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await log({ studentId, status: 'error', reason });
    return { studentId, status: 'error', reason };
  }
}
