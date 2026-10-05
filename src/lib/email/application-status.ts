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
//   - Accepted and Rejected are final: an email never changes them, except that an offer
//     turns Rejected into Accepted. An acknowledgement or document request arriving after
//     the decision changes nothing and is not reported; an email that suggests Rejected
//     for an Accepted application is reported in the chat for a person to look at.
//   - Nothing moves back to Pending, and Submitted never moves back to Missing Items
//     unless the email says the application cannot proceed without documents.
//   - Only applications already on the student are changed; an offer for a university
//     that is not listed is reported, not added.
//   - "Not approved by the KCO" is checked against the Approved Universities list first:
//     if the list shows the course as approved, nothing is rejected and a person is asked
//     to confirm with the KCO (kco.ts).
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
import { playbookBlock } from './companies';

export { newestMessage };
import type { InboxMessage } from './inbox';
import type { Application, ApplicationStatus, Country } from '@/lib/types';
import { handleChangeAgentEvent, type ChangeAgentEvent } from './change-agent';
import { logAiAction } from '@/lib/ai/action-log';
import { aboutKcoApproval, approvedRowsFor } from './kco';
import { sameUniversity, universityWords } from './universities';
import { notifyEmployeeOfStatus } from '@/lib/applications/set-status';

const SETTABLE: ApplicationStatus[] = ['Submitted', 'Missing Items', 'Accepted', 'Rejected'];
const FINAL: ApplicationStatus[] = ['Accepted', 'Rejected'];

const SYSTEM = `You update a Kuwaiti study-abroad agency's application tracker from emails sent by universities, pathway providers (INTO, Study Group, Kaplan, Navitas, OnCampus), agents such as Merit or Alshamlan, and the Kuwait Cultural Office (KCO).

You are given the email (and the text of any attached letters) and the student's applications, each with an index and its current status. Call record_status_changes exactly once.

The agency's statuses:
- "Submitted": the application has been sent to the university and no offer has been received yet. An "application received / under review / we have your application" email. An application received email is Submitted even when it adds that processing starts once the application fee is paid (INTO's standard line — the agency does not pay these). Also an offer that is on hold, delayed or deferred ("offers are currently on hold for the chosen programme", "please email us again once the intake is closer") — the application is in, the offer has not come: Submitted until the offer arrives.
- "Missing Items": the application cannot be submitted or processed until documents or information are provided. "Your application is incomplete", "on hold until we receive…".
- "Accepted": an offer was received — conditional or unconditional. An offer letter, "we are pleased to offer you…".
- "Rejected": the course is not found or closed, the application was unsuccessful or withdrawn, there is no possible way to get an offer, or the KCO says the course/university is not approved.

Rules:
- You are given only the newest message of the thread plus its attachments. Judge only from those.
- Only report a change you can point to in the email. Put the exact supporting words in evidence.
- Match the email to the application by university AND, where the email names it, the course or pathway provider. Use the index given. University names in the list are sometimes misspelt ("Striling" is Stirling) — that is the same application.
- If the email is about this student's application to a university that is NOT in the list, put it in unlisted — it will be added to the list — with the status the email gives it (by the same rules as above: an application received is Submitted, an offer is Accepted), the university as the email names it, the pathway provider if there is one (INTO, Kaplan, Study Group, Navitas, OnCampus), the course if the email names it (else null) and the country.
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
            kcoApproval: {
              type: 'boolean',
              description: 'true only when the reason for Rejected is that the KCO / MOHE does not approve the course or university.',
            },
          },
          required: ['index', 'newStatus', 'reason', 'evidence'],
        },
      },
      unlisted: {
        type: 'array',
        description: "Applications to universities that are not in the student's list.",
        items: {
          type: 'object',
          properties: {
            university: { type: 'string', description: 'As the email names it, e.g. "INTO Saint Louis University".' },
            provider: { type: ['string', 'null'], description: 'INTO, Kaplan, Study Group, Navitas, OnCampus — or null.' },
            course: { type: ['string', 'null'] },
            country: { type: ['string', 'null'], enum: ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland', null] },
            newStatus: { type: 'string', enum: SETTABLE },
            reason: { type: 'string' },
            evidence: { type: 'string', description: 'The exact words in the email.' },
          },
          required: ['university', 'newStatus', 'evidence'],
        },
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

type UnlistedApplication = {
  university: string;
  provider?: string | null;
  course?: string | null;
  country?: Country | null;
  newStatus: ApplicationStatus;
  reason?: string;
  evidence?: string;
};

const COUNTRIES: Country[] = ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'];

/** Two names for one school, allowing a letter or two of misspelling in a distinctive word ("Striling"). */
function closeUniversity(a: string, b: string): boolean {
  if (sameUniversity(a, b)) return true;
  const wa = [...universityWords(a)];
  const wb = [...universityWords(b)];
  if (!wa.length || wa.length !== wb.length) return false;
  const near = (x: string, y: string) => {
    if (x === y) return true;
    if (x.length < 5 || Math.abs(x.length - y.length) > 1) return false;
    let diff = 0;
    for (let i = 0, j = 0; i < x.length || j < y.length; ) {
      if (x[i] === y[j]) { i++; j++; continue; }
      if (++diff > 2) return false;
      if (x.length > y.length) i++;
      else if (y.length > x.length) j++;
      else { i++; j++; }
    }
    return true;
  };
  return wa.every((x) => wb.some((y) => near(x, y)));
}

/**
 * The school as the Approved Universities list names it ("Saint Louis University",
 * "University of Stirling - INTO"), so an application added by the AI matches what staff
 * would pick. Null when the list does not name it, or names it more than one way.
 */
export async function listedUniversity(name: string, provider?: string | null): Promise<{ name: string; country: Country | null } | null> {
  if (!adminDb) return null;
  const rows = (await adminDb.collection('approved_universities').get()).docs.map(
    (d) => d.data() as { name?: string; country?: Country },
  );
  const via = String(provider ?? '').trim().toLowerCase().split(' ')[0];
  const sameSchool = rows.filter((r) => r.name && sameUniversity(r.name, name));
  const viaProvider = via ? sameSchool.filter((r) => String(r.name).toLowerCase().includes(via)) : sameSchool;
  const pool = viaProvider.length ? viaProvider : sameSchool;
  const names = [...new Set(pool.map((r) => String(r.name).trim()))];
  if (names.length !== 1) return null;
  return { name: names[0], country: pool.find((r) => String(r.name).trim() === names[0])?.country ?? null };
}

/** Two names for one school, for the chat AI's checks too. */
export { closeUniversity };

/**
 * Add an application the email is about to the student's list, named as the Approved
 * Universities list names it (so it matches what staff would pick), with the email's
 * status. Never a second copy of one already there. Returns the line for staff.
 */
async function addFromEmail(input: {
  studentId: string;
  item: UnlistedApplication;
  message: InboxMessage;
  dryRun?: boolean;
}): Promise<{ added: boolean; line: string }> {
  const { item, message } = input;
  const db = adminDb!;
  const listed = await listedUniversity(item.university, item.provider);
  const university = listed?.name ?? item.university.replace(/\s+/g, ' ').trim();
  const country = listed?.country ?? (COUNTRIES.includes(item.country as Country) ? (item.country as Country) : null);
  const major = String(item.course ?? '').trim() || 'Course not stated in the email';
  const status = item.newStatus;

  const snap = await db.collection('students').doc(input.studentId).get();
  const s = snap.data();
  if (!s) return { added: false, line: `⚠️ Not in the applications list: ${item.university}` };
  const twin = ((s.applications ?? []) as Application[]).find((a) => closeUniversity(a.university, university));
  if (twin) {
    return { added: false, line: `⚠️ The email is about ${item.university}, which looks like ${twin.university} on the list — not added; check the name.` };
  }
  if (!country) return { added: false, line: `⚠️ Not in the applications list: ${item.university} (${status}) — country unclear, so not added.` };
  if (input.dryRun) return { added: false, line: `[dry run] would add ${university} (${major}, ${country}) as ${status}` };

  const now = new Date().toISOString();
  const app: Application = { university, country, major, status, updatedAt: now };
  if (status === 'Rejected') app.rejectionReason = String(item.reason ?? 'Rejected (from email)').slice(0, 200);
  const result = await db.runTransaction(async (tx) => {
    const fresh = (await tx.get(snap.ref)).data();
    const apps = (fresh?.applications ?? []) as Application[];
    if (apps.some((a) => closeUniversity(a.university, university))) return null;
    const next = [...apps, app];
    tx.update(snap.ref, {
      applications: next,
      lastActivityAt: now,
      adminNotes: FieldValue.arrayUnion({
        id: `note-email-added-${Date.now()}`,
        authorId: 'email-intake',
        content: `Application added from email: ${university} (${major}) as ${status}. Email from ${message.from}, "${message.subject}": "${String(item.evidence ?? '').slice(0, 300)}"`,
        createdAt: now,
      }),
    });
    return next;
  });
  if (!result) return { added: false, line: `ℹ️ ${university} was added to the list meanwhile — not added again.` };

  await logAiAction({
    source: 'email',
    summary: `Added from email: ${university} (${major}) as ${status}`,
    reason: `Email from ${message.fromName || message.from}, "${message.subject}": "${String(item.evidence ?? '').slice(0, 200)}"`,
    studentId: input.studentId,
    studentName: s.name ?? null,
    undo: { type: 'remove_application', university, major, addedStatus: status },
  });
  await notifyEmployeeOfStatus({
    studentId: input.studentId,
    studentName: String(s.name ?? ''),
    employeeId: s.employeeId ?? null,
    university,
    to: status,
    applications: result,
    added: true,
  });
  const check = major.startsWith('Course not stated') ? ' — the email does not name the course, please set it' : '';
  return { added: true, line: `➕ Added to the applications from the email: ${university} (${major}) as ${status}${check}` };
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
  /**
   * An older email read again (applyPastEmail): only an offer or a rejection is applied —
   * an "application received" or a request for documents is long past by now — and a
   * change of agent it mentions is left alone.
   */
  pastEmail?: boolean;
}): Promise<{ changes: StatusChange[]; unlisted: string[]; added: string[]; alreadyCorrect: string[]; changeAgent: string[] }> {
  const none = { changes: [] as StatusChange[], unlisted: [] as string[], added: [] as string[], alreadyCorrect: [] as string[], changeAgent: [] as string[] };
  if (!isAiConfigured() || !adminDb) return none;
  try {
    const snap = await adminDb.collection('students').doc(input.studentId).get();
    const s = snap.data();
    const apps: Application[] = s?.applications ?? [];
    if (!s || apps.length === 0) return none;

    const { message } = input;
    const attachments = await attachmentText(message);
    const res = await getAnthropicClient('email-status').messages.create({
      model: AI_DOC_MODEL,
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, ...(await playbookBlock(message.from))],
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
    // Applications the email is about that are not on the list. One the list does have,
    // under another spelling or provider ("INTO Saint Louis University" for "Saint Louis
    // University"), is that application: handled as a change below, by the same rules.
    const unlisted: string[] = [];
    const toAdd: UnlistedApplication[] = [];
    for (const u of (raw.unlisted ?? []) as Array<string | UnlistedApplication>) {
      if (typeof u === 'string') {
        if (u.trim()) unlisted.push(`⚠️ Not in the applications list: ${u.trim()}`);
        continue;
      }
      if (!u?.university || !SETTABLE.includes(u.newStatus)) continue;
      const twins = apps.map((a, i) => (closeUniversity(a.university, u.university) ? i : -1)).filter((i) => i >= 0);
      if (twins.length === 1) {
        raw.changes = [...(raw.changes ?? []), { index: twins[0], newStatus: u.newStatus, reason: u.reason ?? '', evidence: u.evidence ?? '' }];
      } else if (twins.length > 1) {
        unlisted.push(`⚠️ The email is about ${u.university}, which could be any of ${twins.map((i) => apps[i].university).join(', ')} — nothing changed.`);
      } else {
        toAdd.push(u);
      }
    }

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
        // An "application received" or a document request arriving after the decision is
        // mail out of order, not a conflict: nothing to change and nothing to post.
        if (to === 'Submitted' || to === 'Missing Items') {
          alreadyCorrect.push(`${app.university}: ${app.status}`);
          continue;
        }
        // An offer letter outranks an earlier Rejected (a course said to be closed, a
        // misread notice): the offer is applied. Accepted → Rejected is still only flagged.
        if (!(app.status === 'Rejected' && to === 'Accepted')) {
          change.note = `Not changed — ${app.status} is final. Check whether the email means it should be ${to}.`;
          changes.push(change);
          continue;
        }
      }
      if (input.pastEmail && to !== 'Accepted' && to !== 'Rejected') {
        change.note = 'Not changed — from an older email, only an offer or a rejection is applied.';
        changes.push(change);
        continue;
      }
      if (app.status === 'Submitted' && to === 'Missing Items' && !/incomplete|cannot|can't|unable|on hold|until we receive|before we can/i.test(change.evidence)) {
        change.note = 'Not changed — the email asks for something but does not say the application is held up by it.';
        changes.push(change);
        continue;
      }
      if (to === 'Rejected' && aboutKcoApproval(c.kcoApproval, change.reason, change.evidence)) {
        const listed = await approvedRowsFor(app.university, app.major);
        if (listed.length) {
          change.note = `Not changed — the email says it is not KCO-approved, but your Approved Universities list shows ${listed[0]} as approved. Please confirm with the KCO.`;
          changes.push(change);
          continue;
        }
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

    // The rest are added, with the status the email gives them — not from an older email
    // read again, whose news may be long past.
    const added: string[] = [];
    for (const u of toAdd) {
      if (input.pastEmail) {
        unlisted.push(`⚠️ Not in the applications list: ${u.university} (${u.newStatus})`);
        continue;
      }
      const r = await addFromEmail({ studentId: input.studentId, item: u, message, dryRun: input.dryRun });
      (r.added ? added : unlisted).push(r.line);
    }

    // Change of agent: switch it on for an alert, note an outcome.
    const changeAgent: string[] = [];
    const from = message.fromName || message.from;
    for (const c of input.pastEmail ? [] : raw.changeAgent ?? []) {
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

    return { changes, unlisted, added, alreadyCorrect, changeAgent };
  } catch (e) {
    console.error('[email-status] failed:', e);
    return none;
  }
}

/** Chat / receipt lines for what happened. */
export function statusChangeLines(result: { changes: StatusChange[]; unlisted: string[]; added?: string[]; changeAgent?: string[] }): string[] {
  const lines: string[] = [...(result.changeAgent ?? []), ...(result.added ?? [])];
  for (const c of result.changes) {
    lines.push(
      c.applied
        ? `🎓 ${c.university}: ${c.from} → ${c.to} (${c.reason})`
        : `⚠️ ${c.university}: email suggests ${c.to}. ${c.note ?? ''}`.trim(),
    );
  }
  lines.push(...result.unlisted);
  return lines;
}
