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
import { addApplication, createStudentTask, sendChatMessage, setStudentFinalChoice, updateApplicationStatus } from '@/lib/actions';
import { trustedRole } from '@/lib/auth/trusted-role';
import { FOLLOWUP_COLLECTION, followUpStopped, stopFollowUpWithUndo } from '@/lib/email/followups';
import { sameUniversity } from '@/lib/email/universities';
import { applyPastEmail } from '@/lib/email/past-email';
import { closeUniversity, listedUniversity } from '@/lib/email/application-status';
import { updateStudentIdentity } from '@/lib/students/identity';
import { logAiAction } from './action-log';
import { automateTask } from './task-automation';
import { FieldValue } from 'firebase-admin/firestore';
import type { Application, ApplicationStatus, MissingItem, User } from '@/lib/types';

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

You only see a thread when someone mentions you ("@ai", "Masar AI") or sends the message to you — staff talking to each other never reach you. So someone is always waiting on you.

## "شنو صار عليه؟" — status questions
"شنو صار عليه / عليها؟", "وش صار", "شصار", "any update?", "what's the status?" — someone wants to know where the student stands. You MUST answer (post_reply), never stay silent. Call \`get_student_status\` first; it has everything in one place. Answer in the language of the question, in 2–5 short lines:
- each application that is still alive (not Rejected): university — status, and the latest news with its date (from the emails);
- what is pending and on whom (missing items, a document a university is waiting for, a reply the agency owes);
- a deadline coming up, if there is one.
Leave out Rejected applications unless the question is about them. If the record has nothing new, say so plainly and say who would know (the department handling it, or the assigned employee). Never invent progress.

## Always answer
The newest message was sent to ${CHAT_BOT_NAME} or mentions you: you MUST call \`post_reply\`, never \`stay_silent\`. Only \`post_reply\` reaches the chat — an answer written as plain text is never seen. If you cannot find the answer, say exactly what you could not find and who would know (usually the assigned employee or the department). Never guess: if you are not sure, say so.

## What you can do
- Someone asks a factual question you can answer from the student's record (their applications, statuses, documents, assigned employee, IELTS score, deadlines).
- Someone asks what happened by email ("did they reply", "did we send it") — use \`get_student_emails\`.
- Someone pastes an email and asks why nobody was told — look for it with \`get_student_emails\`. If it is not there, the inbox has not picked it up yet: it is checked Monday–Friday at 10:00, 13:00 and 15:00 Kuwait time, or when an admin presses "Check inbox now" on the Email Intake page. Say that, and pass on what the email asks if staff want it passed on. Never say it was not received.
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
Admins and departments can have you fix a student's applications, as they can on the site. When they ask you to change an application's status or attach a letter that came by email — or point out an email that holds an offer or a rejection the record does not show (for example, when your ⏳ follow-up was wrong) — find that email with \`get_student_emails\` and call \`apply_email\` with its ref: it files the email's attachments on the profile and applies the offer or rejection. For a status change with no email behind it, call \`set_application_status\`; to add a school with no email behind it, \`add_application\`. To add to the student's Missing Items list ("add these to missing items"), call \`add_missing_items\` with one line per item, rewording an item already listed when the new one only adds detail to it — setting an application's status to Missing Items does not add them. When staff tell you which school the student is going with, call \`set_final_choice\` (the assigned employee may ask for this too): from then on the student is finalized: no school is chased and no reminder is sent about them unless an email about them arrives — no stop_follow_up needed — but say which update requests are already waiting in Gmail Drafts, for staff to delete. When staff ask you to fill in or correct the student's name, date of birth or civil ID (the fields at the top of the profile; the record keeps the last two as jotformData.dob and jotformData.civilId), call \`set_student_details\` (the assigned employee may ask too). Use the values staff gave, or read them from the documents with \`get_student_documents\`: the date of birth from the passport; the civil ID only from a civil ID card or a number staff gave you — a number on a school certificate is not proof of it. If the tool says the civil ID does not match the date of birth or is on another student, tell staff and ask them to confirm; pass confirmed only after they do. Then post_reply saying exactly what changed. If the tool refuses, say why. You never delete email: when a Gmail draft should go, say so and leave it to staff.

## Requests already made
"The request", "the task", "the request school" or the name of a request type usually means a request already made for this student, not a new one. Call \`get_student_requests\` first: it lists each request with the school and course picked in it, who made it, when, and where it stands. "Add the request school to the list" means: add each school from those requests that is not on the applications yet, with \`add_application\`, using the school and course exactly as the request names them. Never create a task when staff point to one that exists.

## Creating tasks
When staff ask for something new that matches one of the request types listed below, call \`create_task\` with the matching requestTypeId and a clear description quoting what they asked for. A request that picks a school (adding schools, first year, change of major) needs the school and the course: pass university and major, and if staff did not name them, ask — never create it empty. Then reply in the chat saying what you created. If nothing matches well, do not invent a task — reply asking which request type they want, or stay silent.

## How to write
- Short. Say only what matters. This is a busy work chat, read on phones, not a report.
- One point per paragraph, with a blank line between paragraphs. Several items to do or check go one per line, each starting with "- ". Never pack several points into one long paragraph.
- Plain and direct. No greetings, no sign-offs, no "I hope this helps".
- Staff write in a mix of English and Arabic. Reply in the language the message used.
- In Arabic, keep each English word (CAS, checklist, Merit, a school's name) whole, with a space on both sides. Never join an Arabic letter or "الـ" to it: write "تذكيرات CAS", not "الـCAS reminders". Begin every line and every "- " item with an Arabic word: "- شركة Merit سألت…", not "- Merit سألوا…".
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
        name: 'get_student_requests',
        description:
          "The requests (tasks) made for this student, newest first: the request type, who made it and when, its status, " +
          'the school and course picked in it, notes, what was already done about it and the latest replies. Use it ' +
          'whenever staff mention "the request" or "the task", and before creating a task.',
        input_schema: { type: 'object', properties: {} },
      },
      handler: () => studentRequests(studentId),
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
      : `Not changed: only admins and departments can ${opts.what ?? 'change application statuses or file documents'}, the same as on the site.`;
  };

  tools.push({
    write: false,
    definition: {
      name: 'apply_email',
      description:
        "Apply one of this student's emails to the profile, when admins or departments ask — an offer, a rejection or an " +
        '"application received" the record does not show yet. Files the email\'s attachments on the profile, applies the ' +
        'status it gives to the application it is about, and adds that school to the applications if it is not on the ' +
        'list, under the usual rules. Find the email with get_student_emails and pass its ref.',
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
        staffAsked: true,
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
      name: 'add_application',
      description:
        "Add a school to this student's applications when admins or departments ask (\"add Saint Louis University, " +
        'Computer Science"). It is named as the Approved Universities list names it. Status is Pending unless staff say ' +
        'otherwise. When an email is behind it, use apply_email instead, so its status and letter come with it.',
      input_schema: {
        type: 'object',
        properties: {
          university: { type: 'string' },
          major: { type: 'string' },
          country: { type: 'string', enum: ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'], description: 'Only needed when the school is not on the Approved Universities list.' },
          status: { type: 'string', enum: ['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'] },
          rejectionReason: { type: 'string' },
          note: { type: 'string', description: 'What staff asked, in a few words.' },
        },
        required: ['university', 'major'],
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange({ what: 'add applications' });
      if (refused) return { ok: false, error: refused };
      if (!db) return { ok: false, error: 'Database not available.' };
      const s = (await db.collection('students').doc(studentId).get()).data();
      if (!s) return { ok: false, error: 'Student not found.' };
      const listed = await listedUniversity(String(input.university ?? ''));
      const university = listed?.name ?? String(input.university ?? '').replace(/\s+/g, ' ').trim();
      const country = listed?.country ?? input.country;
      const major = String(input.major ?? '').trim();
      const status = (['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'].includes(input.status) ? input.status : 'Pending') as ApplicationStatus;
      if (!university || !major) return { ok: false, error: 'Not added: give the university and the course.' };
      if (!country) return { ok: false, error: `Not added: ${university} is not on the Approved Universities list — ask which country it is in.` };
      const reason = String(input.rejectionReason ?? '').trim().slice(0, 200);
      if (status === 'Rejected' && !reason) return { ok: false, error: 'Not added: Rejected needs a reason — ask for it.' };
      const twin = ((s.applications ?? []) as Application[]).find((a) => closeUniversity(a.university, university) && a.major.trim().toLowerCase() === major.toLowerCase());
      if (twin) return { ok: true, unchanged: `${twin.university} (${twin.major}) is already on the list, as ${twin.status}.` };
      if (preview) return { ok: true, preview: true, wouldAdd: `${university} (${major}, ${country}) as ${status}` };

      // The site's own action (and its notification to the employee), then the status asked for.
      const r = await addApplication(studentId, university, country, major, s.name, s.employeeId ?? null);
      if (!r.success) return { ok: false, error: `Not added: ${r.message}` };
      if (status !== 'Pending') {
        const u = await updateApplicationStatus(studentId, university, major, status, s.name, s.employeeId ?? null, status === 'Rejected' ? reason : undefined);
        if (!u.success) return { ok: true, added: `${university} (${major}) as Pending`, error: `The status could not be set to ${status}: ${u.message}` };
      }
      const said = String(input.note ?? '').slice(0, 200);
      await logAiAction({
        source: 'chat',
        summary: `Added: ${university} (${major}) as ${status}`,
        reason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
        studentId,
        studentName: s.name ?? null,
        undo: { type: 'remove_application', university, major, addedStatus: status },
      });
      collected.acted = true;
      return { ok: true, added: `${university} (${major}, ${country}) as ${status}` };
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
      name: 'add_missing_items',
      description:
        "Add items to the student's Missing Items list (what the student or the agency still has to provide) when staff " +
        'ask. One short line per item, in English: what is needed, and for which school when staff named one. When an item ' +
        'already on the list is the same thing with fewer details ("IELTS / TOEFL certificate", and the school now gives the ' +
        'minimum score), reword that item instead of adding a second one. An item already on the list is not added again.',
      input_schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' }, description: 'New items, one line each.' },
          reword: {
            type: 'array',
            description: 'Items already on the list that should say more. Each keeps its place, date and author.',
            items: {
              type: 'object',
              properties: {
                current: { type: 'string', description: 'The item exactly as it is on the list now.' },
                text: { type: 'string', description: 'The new wording, keeping what the old one said.' },
              },
              required: ['current', 'text'],
            },
          },
          note: { type: 'string', description: 'What staff asked, in a few words.' },
        },
      },
    },
    handler: async (input) => {
      const refused = await refuseRecordChange({ what: 'add Missing Items' });
      if (refused) return { ok: false, error: refused };
      if (!db) return { ok: false, error: 'Database not available.' };
      const clean = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();
      const texts = [...new Set((Array.isArray(input.items) ? input.items : []).map(clean).filter(Boolean))].slice(0, 10) as string[];
      const rewords = (Array.isArray(input.reword) ? input.reword : [])
        .map((r: { current?: unknown; text?: unknown }) => ({ current: clean(r?.current), text: clean(r?.text) }))
        .filter((r: { current: string; text: string }) => r.current && r.text)
        .slice(0, 10) as Array<{ current: string; text: string }>;
      if (!texts.length && !rewords.length) return { ok: false, error: 'No items given.' };
      const ref = db.collection('students').doc(studentId);
      // As the site's own "Add item": in the name of the person who asked, under their department.
      const asker = (await db.collection('users').doc(requesterId).get()).data() ?? {};
      const department = asker.role === 'admin' || asker.role === 'adminplus' ? 'Admin' : asker.department || 'General';
      const said = String(input.note ?? '').slice(0, 200);

      type Item = string | MissingItem;
      const outcome = await db.runTransaction(async (tx) => {
        const s = (await tx.get(ref)).data();
        if (!s) return { error: 'Student not found.' } as const;
        const list = (s.missingItems ?? []) as Item[];
        const textOf = (m: Item) => (typeof m === 'string' ? m : m.text);
        const unknown = rewords.filter((r) => !list.some((m) => norm(textOf(m)) === norm(r.current)));
        if (unknown.length) {
          return { error: `Not on the list: ${unknown.map((r) => `"${r.current}"`).join(', ')}. The list now: ${list.map((m) => `"${textOf(m)}"`).join(', ') || '(empty)'}.` } as const;
        }
        const now = new Date().toISOString();
        let k = 0;
        const reworded: Array<{ from: string; to: string }> = [];
        const next: Item[] = list.map((m) => {
          const r = rewords.find((x) => norm(x.current) === norm(textOf(m)));
          if (!r || norm(r.text) === norm(textOf(m))) return m;
          reworded.push({ from: textOf(m), to: r.text });
          return typeof m === 'string'
            ? { id: `mi-${Date.now()}-r${k++}`, text: r.text, department, addedBy: requesterId, createdAt: now }
            : { ...m, text: r.text };
        });
        const onList = new Set(next.map((m) => norm(textOf(m))));
        const fresh = texts.filter((t) => !onList.has(norm(t)));
        const already = texts.filter((t) => onList.has(norm(t)));
        const added: MissingItem[] = fresh.map((text, i) => ({ id: `mi-${Date.now()}-${i}`, text, department, addedBy: requesterId, createdAt: now }));
        if (preview || (!added.length && !reworded.length)) return { name: s.name ?? null, added, reworded, already, list, next: [...next, ...added] };
        tx.update(ref, {
          missingItems: [...next, ...added],
          newMissingItemsForEmployee: FieldValue.increment(added.length + reworded.length),
          missingItemsViewedBy: [requesterId],
          lastActivityAt: now,
        });
        return { name: s.name ?? null, added, reworded, already, list, next: [...next, ...added] };
      });
      if ('error' in outcome) return { ok: false, error: outcome.error };
      const { added, reworded, already } = outcome;
      const report = {
        ...(added.length ? { added: added.map((m) => m.text) } : {}),
        ...(reworded.length ? { reworded: reworded.map((r) => `"${r.from}" → "${r.to}"`) } : {}),
        ...(already.length ? { alreadyOnList: already } : {}),
      };
      if (preview) return { ok: true, preview: true, ...report };
      if (!added.length && !reworded.length) return { ok: true, nothingChanged: true, ...report };
      await logAiAction({
        source: 'chat',
        summary: [
          added.length ? `Missing Items added: ${added.map((m) => m.text).join(' · ')}` : '',
          ...reworded.map((r) => `Missing Item reworded: "${r.from}" → "${r.to}"`),
        ]
          .filter(Boolean)
          .join(' · '),
        reason: `Asked in the internal chat by ${requestedBy}${said ? `: "${said}"` : ''}`,
        studentId,
        studentName: outcome.name,
        // A reword can only be undone by putting the whole list back, and only while nobody has changed it since.
        undo: reworded.length
          ? { type: 'set_field', field: 'missingItems', from: outcome.list, to: outcome.next }
          : { type: 'remove_missing_items', ids: added.map((m) => m.id) },
      });
      collected.acted = true;
      return { ok: true, ...report };
    },
  });

  tools.push({
    write: false,
    definition: {
      name: 'set_final_choice',
      description:
        "Set the student's final choice — the school they are going with — when staff ask (\"he is going with Sheffield\", " +
        '"change the final choice to Sheffield"). Give the university exactly as it appears in the applications list. From ' +
        'then on the student is finalized: no school is chased and no reminders are sent, unless an email about them arrives.',
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
      // Update requests already waiting in Gmail Drafts: staff delete those, the AI never does.
      const waiting = (await db.collection(FOLLOWUP_COLLECTION).where('studentId', '==', studentId).get()).docs
        .map((d) => d.data())
        .filter((f) => f.lastDraftedAt && !followUpStopped(f))
        .map((f) => `${f.university}: update request to ${f.to} drafted ${String(f.lastDraftedAt).slice(0, 10)}`);
      if (before === app.university) {
        return { ok: true, unchanged: `The final choice is already ${app.university}.`, draftsToDelete: waiting };
      }
      if (preview) return { ok: true, preview: true, wouldSet: `${before ?? '(none)'} → ${app.university}`, draftsToDelete: waiting };

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
        followUps: 'Finalized: no school is chased and no reminders are sent from now on, unless an email about the student arrives.',
        draftsToDelete: waiting.length ? waiting : 'None waiting.',
      };
    },
  });

  if (allowTaskCreation) {
    tools.push({
      write: false,
      definition: {
        name: 'create_task',
        description:
          'Create a task/request for this student from what staff asked for in the chat. ' +
          'Use one of the requestTypeId values listed in the conversation. A request that picks a school ' +
          '(adding schools, first year, change of major) needs university and major — it is never created ' +
          'without them, and its school is added to the applications as Pending, as on the site. After ' +
          'creating it, post_reply to say what you created.',
        input_schema: {
          type: 'object',
          properties: {
            requestTypeId: { type: 'string', description: 'Must be one of the listed request type ids.' },
            description: {
              type: 'string',
              description: 'What is being requested, quoting the employee where useful.',
            },
            university: { type: 'string', description: 'For a request that picks a school: the school, as staff named it.' },
            major: { type: 'string', description: "The course at that school. For a change of major: the application's current course." },
          },
          required: ['requestTypeId', 'description'],
        },
      },
      handler: async (input) => {
        const requestTypeId = String(input.requestTypeId ?? '');
        const description = String(input.description ?? '');
        if (!db) return { ok: false, error: 'Database not available.' };
        const rt = (await db.collection('request_types').doc(requestTypeId).get()).data();
        if (!rt) return { ok: false, error: 'Unknown requestTypeId — use one of the listed ids.' };
        const picked = await requestSchool(studentId, rt, input.university, input.major);
        if ('error' in picked) return { ok: false, error: picked.error };
        if (picked.school) {
          const refused = await refuseRecordChange({ assignedEmployee: true, what: 'request schools for this student' });
          if (refused) return { ok: false, error: refused };
        }
        if (preview) {
          const wouldCreate = `${String(rt.name).trim()}${picked.school ? ` — ${picked.school}` : ''}`;
          collected.tasks.push({ requestTypeId, description, ok: true, message: `preview: would create ${wouldCreate}` });
          return { ok: true, preview: true, wouldCreate };
        }
        if (observeOnly) {
          collected.tasks.push({ requestTypeId, description, ok: true, message: 'observe-only: not created' });
          return {
            ok: true,
            created: false,
            note: 'Observe-only mode is on: the task was recorded for review but NOT created.',
          };
        }
        const result = await createStudentTask(CHAT_BOT_USER_ID, studentId, requestTypeId, description, picked.data);
        collected.tasks.push({
          requestTypeId,
          description,
          ok: result.success === true,
          message: result.message,
        });
        if (!result.success) return { ok: false, error: result.message ?? 'Task creation failed.' };
        // As when the request is made on the site: its school goes on the applications list now.
        const done = picked.data && rt.specialConfig?.useApprovedUniversitiesList && result.taskId ? (await automateTask(result.taskId)).lines : [];
        return { ok: true, created: true, ...(picked.school ? { school: picked.school } : {}), ...(done.length ? { done } : {}) };
      },
    });
  }

  return tools;
}

const cmpDesc = (a: string, b: string) => (a < b ? 1 : a > b ? -1 : 0);
const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** The schools picked in a request's form (one, or several where the form allows it). */
function requestedSchools(t: Record<string, any>): Array<{ id?: string; name: string; major?: string }> {
  const d = t.data ?? {};
  const list = Array.isArray(d.selectedGlobalUniversities) && d.selectedGlobalUniversities.length ? d.selectedGlobalUniversities : [d.selectedGlobalUniversityDetails];
  return list.filter((u: { name?: string } | undefined) => u?.name);
}

/** The requests made for a student — "the request" staff point to. */
async function studentRequests(studentId: string) {
  if (!db) return { error: 'Database not available' };
  const snap = await db.collection('tasks').where('studentId', '==', studentId).get();
  const requests = snap.docs
    .map((d): Record<string, any> => ({ id: d.id, ...d.data() }))
    .filter((t) => t.category === 'request')
    .sort((a, b) => cmpDesc(String(a.createdAt ?? ''), String(b.createdAt ?? '')))
    .slice(0, 20)
    .map((t) => {
      const app = t.data?.selectedApplicationDetails;
      const schools = requestedSchools(t).map((u) => `${u.name} — ${String(u.major ?? '?').trim()}`);
      return {
        type: String(t.taskType ?? '').trim(),
        by: t.authorName ?? null,
        on: String(t.createdAt ?? '').slice(0, 10),
        status: t.status ?? null,
        ...(schools.length ? { schools } : {}),
        ...(app?.university ? { application: `${app.university} — ${app.major}` } : {}),
        ...(t.data?.notes ? { notes: String(t.data.notes).slice(0, 300) } : {}),
        ...(t.content && !/^Dynamic request:/.test(t.content) ? { details: String(t.content).slice(0, 400) } : {}),
        ...(t.aiAutomation?.lines?.length ? { alreadyDone: t.aiAutomation.lines } : {}),
        ...(t.denialReason ? { denialReason: t.denialReason } : {}),
        latestReplies: ((t.replies ?? []) as Array<{ authorName?: string; content?: string }>)
          .slice(-3)
          .map((r) => `${r.authorName ?? 'staff'}: ${String(r.content ?? '').slice(0, 200)}`),
      };
    });
  return { count: requests.length, requests };
}

/**
 * What a request type's form holds for the school staff named: the Approved Universities
 * course for an add-school request, the student's own application for a change of major.
 * A request whose form picks a school is never made without one, nor twice while open.
 */
async function requestSchool(
  studentId: string,
  rt: Record<string, any>,
  university: unknown,
  major: unknown,
): Promise<{ data?: Record<string, unknown>; school?: string } | { error: string }> {
  const cfg = rt.specialConfig ?? {};
  if (!cfg.useApprovedUniversitiesList && !cfg.requireUniversitySelection) return {};
  const name = String(university ?? '').replace(/\s+/g, ' ').trim();
  const course = String(major ?? '').replace(/\s+/g, ' ').trim();
  if (!name || !course) {
    return {
      error:
        `Not created: "${String(rt.name).trim()}" needs the school and the course. Ask staff which — or, if they mean ` +
        'a request already made for this student, read it with get_student_requests.',
    };
  }
  const s = (await db!.collection('students').doc(studentId).get()).data();
  if (!s) return { error: 'Student not found.' };

  if (cfg.requireUniversitySelection) {
    const found = findApplication((s.applications ?? []) as Application[], name, course);
    if ('error' in found) return { error: `Not created: ${found.error}` };
    const a = found.app;
    return {
      school: `${a.university} (${a.major})`,
      data: {
        selectedApplicationId: `${a.university}|${a.major}`,
        selectedApplicationDetails: { university: a.university, major: a.major, country: a.country, status: a.status },
      },
    };
  }

  const rows = (await db!.collection('approved_universities').get()).docs
    .map((d) => ({ id: d.id, ...(d.data() as { name?: string; major?: string; country?: string; category?: string }) }))
    .filter((r) => r.name && (!cfg.countryFilter || r.country === cfg.countryFilter));
  let school = rows.filter((r) => norm(r.name) === norm(name));
  if (!school.length) {
    school = rows.filter((r) => closeUniversity(r.name!, name));
    // "Liverpool Kaplan": the provider named picks between the pathway versions of one school.
    const providers = norm(name).split(/[^a-z]+/).filter((w) => ['kaplan', 'into', 'navitas', 'oncampus', 'isc'].includes(w));
    const viaProvider = school.filter((r) => providers.some((p) => norm(r.name).includes(p)));
    if (viaProvider.length) school = viaProvider;
  }
  const names = [...new Set(school.map((r) => r.name!.trim()))];
  if (names.length > 1) return { error: `Not created: "${name}" could be ${names.join(' or ')}. Ask which.` };
  if (!names.length) return { error: `Not created: ${name} is not on the Approved Universities list${cfg.countryFilter ? ` for the ${cfg.countryFilter}` : ''}.` };
  let hit = school.filter((r) => norm(r.major) === norm(course));
  if (!hit.length) hit = school.filter((r) => norm(r.major).includes(norm(course)) || norm(course).includes(norm(r.major)));
  if (hit.length !== 1) {
    return {
      error: `Not created: ${hit.length ? 'several courses' : 'no course'} at ${names[0]} match "${course}". Its courses: ${school.map((r) => String(r.major).trim()).join('; ')}.`,
    };
  }
  const u = hit[0];
  const label = `${u.name} (${String(u.major).trim()})`;
  const open = (await db!.collection('tasks').where('studentId', '==', studentId).get()).docs
    .map((d) => d.data())
    .find(
      (t) =>
        t.category === 'request' &&
        t.status !== 'completed' &&
        t.status !== 'denied' &&
        requestedSchools(t).some((x) => x.id === u.id || (norm(x.name) === norm(u.name) && norm(x.major) === norm(u.major))),
    );
  if (open) return { error: `Not created: ${label} was already requested by ${open.authorName ?? 'staff'} on ${String(open.createdAt).slice(0, 10)} and that request is still open.` };
  const details = { id: u.id, name: u.name, major: u.major, country: u.country, category: u.category ?? null };
  return {
    school: label,
    data: cfg.allowMultipleUniversitySelection
      ? { selectedGlobalUniversityIds: [u.id], selectedGlobalUniversities: [details] }
      : { selectedGlobalUniversityId: u.id, selectedGlobalUniversityDetails: details },
  };
}

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
      ? { ...(await getResponderSettings()), enabled: true, observeOnly: true }
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

    // Masar AI replies only when someone mentions it or sends the message to it — staff
    // talking to each other are left alone. Skipped messages cost nothing (no model call,
    // no log write) and are left unclaimed.
    if (!addressesBot(last)) {
      return { studentId, status: 'silent', reason: 'not addressed to Masar AI' };
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
        .map((a: any) => `${a.university} — ${a.major} (${a.country}) — ${a.status}`)
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
