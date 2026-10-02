// Setting a student's application status from the email the university sent.
//
// The agency's rules, as the admin set them:
//   Pending        — the default; nothing has happened yet. Never set from an email.
//   Submitted      — the application has been sent; no offer yet ("application received").
//   Missing Items  — it cannot be submitted / processed until documents are provided.
//   Accepted       — an offer was received (conditional or unconditional).
//   Rejected       — the course is not found / closed, there is no possible way to an
//                    offer, or the course is not approved by the KCO.
//
// Guard rails, enforced here rather than left to the model:
//   - Accepted and Rejected are final: an email never changes them. If it seems to
//     disagree, that is reported in the chat for a person to look at.
//   - Nothing moves back to Pending, and Submitted never moves back to Missing Items
//     unless the email says the application cannot proceed without documents.
//   - Only applications already on the student are changed; an offer for a university
//     that is not listed is reported, not added.
//   - The change goes through updateApplicationStatus, so the employee is notified
//     exactly as when staff change it by hand, and an admin note records the email.

import Anthropic from '@anthropic-ai/sdk';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_DOC_MODEL, isAiConfigured } from '@/lib/ai/config';
import { updateApplicationStatus } from '@/lib/actions';
import { extractPdfText } from './document-compare';
import { newestMessage } from './text';
import { playbookFor } from './companies';

export { newestMessage };
import type { InboxMessage } from './inbox';
import type { Application, ApplicationStatus } from '@/lib/types';
import { handleChangeAgentEvent, type ChangeAgentEvent } from './change-agent';
import { logAiAction } from '@/lib/ai/action-log';

const SETTABLE: ApplicationStatus[] = ['Submitted', 'Missing Items', 'Accepted', 'Rejected'];
const FINAL: ApplicationStatus[] = ['Accepted', 'Rejected'];

const SYSTEM = `You update a Kuwaiti study-abroad agency's application tracker from emails sent by universities, pathway providers (INTO, Study Group, Kaplan, Navitas, OnCampus), agents such as Merit or Alshamlan, and the Kuwait Cultural Office (KCO).

You are given the email (and the text of any attached letters) and the student's applications, each with an index and its current status. Call record_status_changes exactly once.

The agency's statuses:
- "Submitted": the application has been sent to the university and no offer has been received yet. An "application received / under review / we have your application" email.
- "Missing Items": the application cannot be submitted or processed until documents or information are provided. "Your application is incomplete", "on hold until we receive…".
- "Accepted": an offer was received — conditional or unconditional. An offer letter, "we are pleased to offer you…".
- "Rejected": the course is not found or closed, the application was unsuccessful or withdrawn, there is no possible way to get an offer, or the KCO says the course/university is not approved.

Rules:
- You are given only the newest message of the thread plus its attachments. Judge only from those.
- Only report a change you can point to in the email. Put the exact supporting words in evidence.
- Match the email to the application by university AND, where the email names it, the course or pathway provider. Use the index given. If the email is about a university that is not in the list, put it in unlisted instead.
- One email can update several applications (e.g. an agent sending results for several schools).
- A request for a document AFTER an offer (signed acceptance form, deposit, CAS documents) does not change an Accepted application.
- Emails that are only marketing, receipts, reminders or general information change nothing.
- If nothing changes, return an empty changes list.

Change of agent — report these in changeAgent, not in changes:
- "conflict": the university says another agent / counsellor has also applied for this student, a conflicting application, a transfer policy, or asks which agent the student wants. Give any deadline for the student's decision.
- "transferred_away": the outcome — the student chose the other agent; the application moved away from us.
- "stays_with_us": the outcome — the application remains under our representation.
For change of agent, the application index may be null if the email names only the provider (e.g. INTO) and not a university on the list; then put the university or provider as named in university.`;

const TOOL: Anthropic.Tool = {
  name: 'record_status_changes',
  description: 'Record the application status changes this email supports.',
  input_schema: {
    type: 'object',
    properties: {
      changes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            newStatus: { type: 'string', enum: SETTABLE },
            reason: { type: 'string', description: 'Short, for staff, e.g. "Unconditional offer received".' },
            evidence: { type: 'string', description: 'The exact words in the email or letter.' },
          },
          required: ['index', 'newStatus', 'reason', 'evidence'],
        },
      },
      unlisted: {
        type: 'array',
        items: { type: 'string' },
        description: 'Offers or decisions for universities not in the list, one line each.',
      },
      changeAgent: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: ['integer', 'null'] },
            university: { type: 'string' },
            event: { type: 'string', enum: ['conflict', 'transferred_away', 'stays_with_us'] },
            deadline: {
              type: ['string', 'null'],
              description: 'The decision deadline as a date (YYYY-MM-DD). "5 days to respond" counts from the email date.',
            },
            evidence: { type: 'string' },
          },
          required: ['university', 'event', 'evidence'],
        },
      },
    },
    required: ['changes'],
  },
};

export type StatusChange = {
  university: string;
  major: string;
  from: ApplicationStatus;
  to: ApplicationStatus;
  reason: string;
  evidence: string;
  applied: boolean;
  note?: string;
};

/** Text of attached PDFs (offer letters), trimmed, so the model sees what the letter says. */
async function attachmentText(message: InboxMessage): Promise<string> {
  const parts: string[] = [];
  for (const att of message.attachments.slice(0, 4)) {
    const text = await extractPdfText(att.content, att.contentType);
    parts.push(
      text
        ? `--- Attachment "${att.filename}" ---\n${text.slice(0, 5000)}`
        : `--- Attachment "${att.filename}" (${att.contentType}, text not readable) ---`,
    );
  }
  return parts.join('\n\n');
}

/**
 * Read the email, decide what it means for the student's applications, and apply the
 * changes the rules allow. Returns what happened, for the chat note and the receipt.
 * Never throws.
 */
export async function updateApplicationsFromEmail(input: {
  message: InboxMessage;
  studentId: string;
  /** Work out the changes but apply nothing — for previews and tests. */
  dryRun?: boolean;
}): Promise<{ changes: StatusChange[]; unlisted: string[]; alreadyCorrect: string[]; changeAgent: string[] }> {
  const none = { changes: [] as StatusChange[], unlisted: [] as string[], alreadyCorrect: [] as string[], changeAgent: [] as string[] };
  if (!isAiConfigured() || !adminDb) return none;
  try {
    const snap = await adminDb.collection('students').doc(input.studentId).get();
    const s = snap.data();
    const apps: Application[] = s?.applications ?? [];
    if (!s || apps.length === 0) return none;

    const { message } = input;
    const attachments = await attachmentText(message);
    const res = await getAnthropicClient().messages.create({
      model: AI_DOC_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      messages: [
        {
          role: 'user',
          content: [
            `Student: ${s.name}`,
            'Applications:',
            ...apps.map((a, i) => `${i}. ${a.university} — ${a.major} (${a.country}) — currently ${a.status}`),
            '',
            `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
            `Subject: ${message.subject}`,
            `Date: ${message.date.slice(0, 10)}`,
            '',
            newestMessage(message.text).slice(0, 12_000),
            attachments ? `\n${attachments}` : '',
            await playbookFor(message.from).then((pb) => (pb ? `\n\n${pb}` : '')),
          ].join('\n'),
        },
      ],
    });
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (!use) return none;
    const raw = use.input as { changes?: any[]; unlisted?: unknown[]; changeAgent?: any[] };

    const changes: StatusChange[] = [];
    /** Applications the email speaks to whose status already says the same — nothing to do. */
    const alreadyCorrect: string[] = [];
    const seen = new Set<number>();
    for (const c of raw.changes ?? []) {
      const i = Number(c.index);
      const app = apps[i];
      const to = c.newStatus as ApplicationStatus;
      if (!app || seen.has(i) || !SETTABLE.includes(to)) continue;
      seen.add(i);
      const change: StatusChange = {
        university: app.university,
        major: app.major,
        from: app.status,
        to,
        reason: String(c.reason ?? '').slice(0, 200),
        evidence: String(c.evidence ?? '').slice(0, 300),
        applied: false,
      };
      if (app.status === to) {
        alreadyCorrect.push(`${app.university}: ${to}`);
        continue;
      }
      if (FINAL.includes(app.status)) {
        change.note = `Not changed — ${app.status} is final. Check whether the email means it should be ${to}.`;
        changes.push(change);
        continue;
      }
      if (app.status === 'Submitted' && to === 'Missing Items' && !/incomplete|cannot|can't|unable|on hold|until we receive|before we can/i.test(change.evidence)) {
        change.note = 'Not changed — the email asks for something but does not say the application is held up by it.';
        changes.push(change);
        continue;
      }

      if (input.dryRun) {
        change.note = 'Dry run — not applied.';
        changes.push(change);
        continue;
      }
      const result = await updateApplicationStatus(
        input.studentId,
        app.university,
        app.major,
        to,
        s.name,
        s.employeeId ?? null,
        to === 'Rejected' ? change.reason : undefined,
      );
      change.applied = result.success === true;
      if (!change.applied) change.note = result.message;
      else {
        await logAiAction({
          source: 'email',
          summary: `${app.university}: ${app.status} → ${to} (${change.reason})`,
          reason: `Email from ${message.fromName || message.from}, "${message.subject}": "${change.evidence}"`,
          studentId: input.studentId,
          studentName: s.name ?? null,
          undo: { type: 'app_status', university: app.university, major: app.major, from: app.status, to, rejectionReason: app.rejectionReason ?? null },
        });
      }
      changes.push(change);
    }

    const applied = changes.filter((c) => c.applied);
    if (applied.length) {
      const now = new Date().toISOString();
      await snap.ref.update({
        adminNotes: FieldValue.arrayUnion(
          ...applied.map((c, k) => ({
            id: `note-email-status-${Date.now()}-${k}`,
            authorId: 'email-intake',
            content:
              `Application status set from email: ${c.university} ${c.from} → ${c.to} (${c.reason}). ` +
              `Email from ${message.from}, "${message.subject}": "${c.evidence}"`,
            createdAt: now,
          })),
        ),
      });
    }

    const unlisted = (raw.unlisted ?? []).filter((u): u is string => typeof u === 'string' && !!u.trim());

    // Change of agent: switch it on for an alert, note an outcome.
    const changeAgent: string[] = [];
    const from = message.fromName || message.from;
    for (const c of raw.changeAgent ?? []) {
      if (!['conflict', 'transferred_away', 'stays_with_us'].includes(c?.event)) continue;
      let app = Number.isInteger(c.index) ? apps[c.index] : undefined;
      // INTO often names only itself. With exactly one application through that provider,
      // that is the one; with several, it stays general rather than flag the wrong school.
      if (!app && typeof c.university === 'string') {
        const provider = c.university.trim().toLowerCase();
        const viaProvider = apps.filter((a) => a.university.toLowerCase().includes(provider));
        if (viaProvider.length === 1) app = viaProvider[0];
      }
      const event: ChangeAgentEvent = {
        university: app?.university ?? String(c.university ?? 'General Request').slice(0, 120),
        event: c.event,
        deadline: typeof c.deadline === 'string' ? c.deadline : null,
        evidence: String(c.evidence ?? '').slice(0, 300),
        from,
      };
      if (input.dryRun) {
        changeAgent.push(`[dry run] ${event.event} — ${event.university}${event.deadline ? ` (deadline ${event.deadline})` : ''}`);
        continue;
      }
      const line = await handleChangeAgentEvent(input.studentId, event);
      if (line) changeAgent.push(line);
    }

    return { changes, unlisted, alreadyCorrect, changeAgent };
  } catch (e) {
    console.error('[email-status] failed:', e);
    return none;
  }
}

/** Chat / receipt lines for what happened. */
export function statusChangeLines(result: { changes: StatusChange[]; unlisted: string[]; changeAgent?: string[] }): string[] {
  const lines: string[] = [...(result.changeAgent ?? [])];
  for (const c of result.changes) {
    lines.push(
      c.applied
        ? `🎓 ${c.university}: ${c.from} → ${c.to} (${c.reason})`
        : `⚠️ ${c.university}: email suggests ${c.to}. ${c.note ?? ''}`.trim(),
    );
  }
  for (const u of result.unlisted) lines.push(`⚠️ Not in the applications list: ${u}`);
  return lines;
}
