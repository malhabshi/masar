// How masar works — the AI's reference for the agency's own process.
//
// Three layers, in order of authority:
//   1. Team notes (app_settings/ai_knowledge) — written by the agency's admins, in their
//      words. Where a note disagrees with the guide, the note wins: it is how the team
//      actually works, which the code cannot always say (what "orange" means, for one).
//   2. Live settings read from Firestore at question time — request types, checklists,
//      lateness thresholds, terms, missing-item templates. Never copied into this file,
//      because they change from the settings pages without a deploy.
//   3. The guide below — what the code does. Every rule here was read from the code on
//      the ai-assistant branch; keep it in step when the behaviour it describes changes.

import { adminDb } from '@/lib/firebase/admin';
import { getLateRules } from '@/lib/late-applications';

export const WORK_GUIDE: Record<string, { title: string; text: string }> = {
  roles: {
    title: 'Roles and who sees what',
    text: `Roles: admin, adminplus, employee, department, student.
- employee: sees only students assigned to them (students.employeeId == their civil ID). Writes employee notes, the employee status note, the employee documents card and the readiness checklist for their own students. Cannot change application status.
- department: one of UK, USA, AU/NZ. Sees students whose applications are in their region (UK→UK, USA→USA, Australia/New Zealand→AU/NZ). Can change application status, delete applications, change majors, add admin notes, manage missing items, the admin checklist and approved universities, and handle tasks addressed to their department.
- Ireland belongs to no department: department users do not see Ireland-only students and are not notified about them.
- admin: everything — tasks, chats, invoices, reports, user management, request settings, deleting students and tasks, closing/reopening profiles, the AI Assistant and Email Documents.
- adminplus: like admin for viewing and for application status, closing/reopening, the Unified Exam page and official-site alerts, but cannot write admin notes, delete, or reach admin-only pages such as invoices and user management.
- Admins and department users can switch into "employee view".`,
  },
  students: {
    title: 'Student lifecycle',
    text: `Created three ways: Add Student (manual), the JotForm page, or bulk import (always unassigned).
- Assignment is students.employeeId = the employee's CIVIL ID (not their user id). Unassigned = null. A new unassigned student alerts every admin.
- Transfer: an employee requests it (an admin request task); an admin transfers or declines. Bulk assign/transfer exists.
- Duplicate phones (phone, phone2, phone3) raise a warning on the profile; they never block creation.
- Deletion: an employee requests it; an admin either rejects the request or deletes the student (a hard delete of files, chat and record). There is no separate "approve".
- Closing (admin/adminplus): adds "-Closed" to the name, pipeline → black, every application → Rejected, the student moves to the TEST account, change-agent flags are cleared. Non-passport documents are deleted 30 days after closing.
- Reopening: removes "-Closed", applications → Pending, pipeline → none, student becomes unassigned.
- Closed students are archived; leave them out of operational numbers unless asked.
- Change agent: when another agent also applies for our student, the university (Study Group, INTO…) emails a "conflicting application" / "transfer policy" alert with a deadline for the student to choose. Change Agent is then switched on for that school (by staff, or by the email intake as "Masar AI (from email)"), which alerts the employee, admins and the department. Many closed profiles were closed for "change agent".
- Inactivity: a student is "stagnant" after 20 days without activity (excluding change agent, ready to travel, and finalised students). The assigned employee files an inactivity report; automatic reminders go out at most every 48h per student.`,
  },
  pipeline: {
    title: 'Pipeline colours',
    text: `students.pipelineStatus: green, yellow, orange, red, black, none ("No Status"). Staff talk about students by colour ("he's orange").
- Set by hand from the Applicants table by the employee or admin/department. Every change writes an admin note.
- Automatic: new students start at none; closing sets black; reopening and forced inactivity reset to none.
- The code does NOT define what green, yellow, orange or red mean. Use the team notes for that; if there is none, say you do not know the agency's definition rather than guessing.`,
  },
  applications: {
    title: 'Applications',
    text: `Each student holds applications[]: university, major, country (UK, USA, Australia, New Zealand, Ireland), status, updatedAt, optional rejectionReason and submissionMethod (Direct, Merit, IGEC, Applyboard, alshamlan, acceptiex, Other).
- Statuses: Pending → Submitted → Missing Items / Accepted / Rejected. Any status can move to any other; Accepted and Rejected are final for lateness purposes. New applications start Pending.
- Status changes are made by admin/adminplus/department and notify the assigned employee (task notification + WhatsApp).
- Final choice: the assigned employee marks one university as final (finalChoiceUniversity). Finalised students appear on the Finalized page.
- Accepted lists: acceptedInfo {country, major} + importListName mark a student found on an imported MOHE acceptance list ("mohesAccepted" in reports). The accepted_list registry tags students who are created later with the same phone or civil ID.
- Intake: academicIntakeSemester + academicIntakeYear (terms such as "FALL (8/9) 2026"). Study level: Foundation, First Year, Transfer Student. IELTS: ieltsOverall. Grade: highSchoolGrade.
- Lateness is masar's own rule, not a university deadline: days since the application's last status change against a threshold per status. Read the live thresholds; never quote them from memory.
- Foundation students: at most 5 schools per pathway company (Into, Studygroup, Kaplan, OnCampus, Navitas, Other); Inhouse is exempt.`,
  },
  checklists: {
    title: 'Checklists and missing items',
    text: `- Readiness checklist (employee): profileCompletionStatus, Foundation students only. Default steps: submit university application, apply for MOHE scholarship, submit KCO request, receive CAS/I-20, apply for visa, visa granted, documents submitted to MOHE, medical fitness, financial statements, ready to travel (final — needs all others first). The live list is in the settings.
- Admin checklist: adminChecklistStatus, configured in App Settings, hidden for First Year and Transfer students.
- Missing items: added by admin/adminplus/department (labelled by their department), flagged to the employee, removed when marked received. Templates are in the settings.`,
  },
  documents_chat_notes: {
    title: 'Documents, internal chat and notes',
    text: `- Documents: two cards on the profile — Employee Documents (the assigned employee uploads) and Admin/Dept Documents (admin/adminplus/department). Students can also upload through public upload links. An upload notifies the other side.
- Internal chat (chats/{studentId}/messages) is between STAFF about a student; the student never sees it. A message can be addressed to specific people, to "Admins" (all admins) and/or "Departments" (the departments matching the student's applications). Addressees get an unread count and a WhatsApp message (not for closed students).
- Employee notes: written by the assigned employee, visible to everyone.
- Admin notes: admin/department only, and also the profile's audit log — the system writes one for pipeline changes, transfers, final choice, IELTS/grade/level/intake changes, closing, task replies.
- Status note (employee, visible to all) and management status note (admin only) are one-line summaries on the Applicants table.`,
  },
  tasks: {
    title: 'Tasks, requests and notifications',
    text: `The tasks collection holds three kinds of record (category):
- request: a real request raised from a student profile using a request type (IELTS/TOEFL bookings, exam registrations, university applications, document requests…). Routed to users, "Admins" and/or a department (dept:UK, dept:USA, dept:AU/NZ). Statuses: new → in-progress (automatic on the first reply) → completed or denied (denial needs a reason). Admin/department change status; replies and quick notifications are copied into admin notes; priority can be toggled.
- system: automatic notifications (status changes, transfers, new unassigned students, final choice…). For these, new = unread and completed = read.
- update: a management broadcast to staff (can go to everyone).
- Transfer and Deletion requests, IELTS Course and Unified Exam requests are kept off the Tasks page; the latter two have their own pages.
- IELTS Course: each course has a timing and a ballroom, set by an admin on the request type and kept on the request (courseTiming, courseBallroom). Registering a student adds a reminder on the student's page for the course start and emails every detail from the agency mailbox to the employee who registered.
- WhatsApp templates (notification_templates) drive outgoing WhatsApp messages for each event.
- Reminders (student_reminders) send four stages: on creation, 24h before, 1h before, 5 minutes before — to admins, the assigned employee, a department, everyone, or chosen people.`,
  },
  jotform: {
    title: 'JotForm submissions',
    text: `The Jotform page submits a student's applications to the pathway forms for UK, AU/NZ and USA (Ireland has no form and is stored directly), then creates the student:
- Refuses up front if any company would exceed 5 schools.
- Only after the forms succeed does it create the profile; the assigned employee comes from the chosen follow-up person.
- Every uploaded file (passport, certificates, IELTS, transcripts, other) is stored on the profile in Employee Documents, plus a generated summary PDF.
- Study level comes from the acceptance type (default Foundation). The intake is set to FALL (8/9) 2027 when UK is included, otherwise SPRING (1/2) 2027.
- Later, more countries can be added from the profile; that re-sends the stored files and needs a stored passport.
- The AI cannot submit JotForm itself — it needs the files uploaded in the browser.`,
  },
  universities: {
    title: 'Approved universities',
    text: `approved_universities: name, major, foundation name, country, category (MOHE, Merit, General), company, open/closed (isAvailable), notes and an important note. Requirements are kept per entry level (Foundation, First Year, Bachelor Degree): IELTS overall and per band (listening, reading, writing, speaking) plus other requirements; a level with nothing recorded uses the general IELTS score. Edited by admin/department.`,
  },
  invoices_reports: {
    title: 'Invoices, reports and official updates',
    text: `- Invoices (admin only): numbered INV-1001 upward; status paid / unpaid / cancelled; currency KWD, USD or GBP; templates and saved items.
- Dashboard numbers leave out closed students and students whose employee no longer exists. Date-range reports (Reports page) include closed students. Employee hours come from login sessions that close after 60 minutes idle.
- Official updates: once a day the system checks the Kuwait Cultural Office in London (kcouk.org), the Cultural Office in Washington, and MOHE news, announcements, e-services and decisions, and shows any change on the admin dashboard.`,
  },
};

export const WORK_GUIDE_TOPICS = Object.keys(WORK_GUIDE);

const NOTES_DOC = { collection: 'app_settings', doc: 'ai_knowledge' };

export type TeamNote = { id: string; topic: string; text: string; addedBy: string; addedAt: string };

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

export async function getTeamNotes(): Promise<TeamNote[]> {
  const snap = await db().collection(NOTES_DOC.collection).doc(NOTES_DOC.doc).get();
  const notes = snap.exists ? snap.data()?.notes : [];
  return Array.isArray(notes) ? notes : [];
}

export async function addTeamNote(input: { topic: string; text: string; addedBy: string }): Promise<TeamNote> {
  const text = input.text.trim();
  if (!text) throw new Error('The note is empty.');
  const note: TeamNote = {
    id: `n-${Date.now().toString(36)}`,
    topic: input.topic.trim() || 'general',
    text,
    addedBy: input.addedBy,
    addedAt: new Date().toISOString(),
  };
  const ref = db().collection(NOTES_DOC.collection).doc(NOTES_DOC.doc);
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const notes: TeamNote[] = snap.exists && Array.isArray(snap.data()?.notes) ? snap.data()!.notes : [];
    tx.set(ref, { notes: [...notes, note], updatedAt: note.addedAt }, { merge: true });
  });
  return note;
}

export async function removeTeamNote(id: string): Promise<boolean> {
  const ref = db().collection(NOTES_DOC.collection).doc(NOTES_DOC.doc);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const notes: TeamNote[] = snap.exists && Array.isArray(snap.data()?.notes) ? snap.data()!.notes : [];
    const next = notes.filter((n) => n.id !== id);
    if (next.length === notes.length) return false;
    tx.set(ref, { notes: next, updatedAt: new Date().toISOString() }, { merge: true });
    return true;
  });
}

/** The settings that change from the app's own settings pages, read fresh. */
async function liveSettings(topic?: string) {
  const want = (t: string) => !topic || topic === t;
  const out: Record<string, unknown> = {};
  const meta = db().collection('system_metadata');

  const jobs: Promise<void>[] = [];
  if (want('tasks')) {
    jobs.push(
      db().collection('request_types').get().then((snap) => {
        out.requestTypes = snap.docs.map((d) => {
          const r = d.data();
          return {
            id: d.id,
            name: r.name,
            description: r.description ?? null,
            active: r.isActive !== false,
            sentTo: (r.recipients ?? []).map((x: { name?: string; id?: string }) => x.name ?? x.id),
            requiredFields: r.requiredFields ?? [],
          };
        });
      }),
    );
  }
  if (want('checklists')) {
    jobs.push(
      meta.doc('checklist_config').get().then((s) => { out.readinessChecklist = s.data()?.items ?? 'default list'; }),
      meta.doc('admin_checklist_config').get().then((s) => { out.adminChecklist = s.data()?.items ?? []; }),
      meta.doc('missing_item_templates').get().then((s) => { out.missingItemTemplates = s.data()?.items ?? []; }),
    );
  }
  if (want('applications')) {
    jobs.push(
      getLateRules().then((r) => { out.lateApplicationRules = r; }),
      db().collection('academic_terms').get().then((snap) => {
        out.academicTerms = snap.docs.map((d) => d.data().name ?? d.id);
      }),
    );
  }
  await Promise.all(jobs.map((j) => j.catch(() => undefined)));
  return out;
}

export async function getWorkGuide(topic?: string) {
  const key = topic && WORK_GUIDE[topic] ? topic : undefined;
  if (topic && !key) {
    return { error: `Unknown topic "${topic}". Topics: ${WORK_GUIDE_TOPICS.join(', ')}.` };
  }
  const [notes, live] = await Promise.all([getTeamNotes().catch(() => []), liveSettings(key)]);
  const guide = key ? { [key]: WORK_GUIDE[key] } : WORK_GUIDE;
  return {
    howToUse:
      'Team notes are the agency\'s own rules and override the guide where they disagree. ' +
      'Live settings are current as of now. The guide describes what the system does.',
    teamNotes: key ? notes.filter((n) => n.topic === key || n.topic === 'general') : notes,
    liveSettings: live,
    guide,
  };
}
