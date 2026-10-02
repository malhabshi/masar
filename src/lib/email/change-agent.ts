// Change of agent, from the university's email.
//
// Study Group: "we have received a conflicting application from another agent… unless we
// receive a Change of Agent instruction from the student by 10th August…". INTO: "the
// student… has submitted a new application to INTO through another counsellor… transfer
// policy… 5 days to respond". Staff used to read these and switch Change Agent on by hand.
//
// An alert switches Change Agent on for that university — the same fields, log and
// 🚨 alerts as the switch on the profile — and writes a note with the deadline. A later
// email with the outcome (the student moved to the other agent, or stayed with us) is
// noted but changes no flag: closing a change-agent case stays a person's decision.
//
// Server-only on purpose. The profile's switch is a server action that checks the caller
// is an admin or department user; giving the email system a way through it would also
// give one to anyone who can call a server action.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import { triggerWhatsAppNotification } from '@/lib/actions';
import type { ChangeAgentLogEntry, Student, User } from '@/lib/types';
import { logAiAction } from '@/lib/ai/action-log';

export const EMAIL_ACTOR_NAME = 'Masar AI (from email)';

export type ChangeAgentEvent = {
  university: string;
  event: 'conflict' | 'transferred_away' | 'stays_with_us';
  deadline: string | null;
  evidence: string;
  from: string;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

function departmentsFor(student: Student, universities: string[]): string[] {
  const countries = new Set(
    (student.applications ?? []).filter((a) => universities.includes(a.university)).map((a) => a.country),
  );
  const out: string[] = [];
  if (countries.has('UK')) out.push('UK');
  if (countries.has('USA')) out.push('USA');
  if (countries.has('Australia') || countries.has('New Zealand')) out.push('AU/NZ');
  return out;
}

/**
 * Act on one change-agent email for one student. Returns the line for the chat note and
 * the email summary. Never throws.
 */
export async function handleChangeAgentEvent(studentId: string, ev: ChangeAgentEvent): Promise<string> {
  try {
    const ref = db().collection('students').doc(studentId);
    const snap = await ref.get();
    if (!snap.exists) return '';
    const student = snap.data() as Student;
    const now = new Date().toISOString();
    const deadline = ev.deadline ? ` Decision deadline: ${ev.deadline}.` : '';

    const note = (content: string) => ({
      id: `note-email-ca-${Date.now()}`,
      authorId: 'email-intake',
      content,
      createdAt: now,
    });

    if (ev.event !== 'conflict') {
      const outcome =
        ev.event === 'transferred_away'
          ? `the student moved this application to the other agent`
          : `the application stays with us`;
      await ref.update({
        adminNotes: FieldValue.arrayUnion(
          note(`Change agent outcome from ${ev.from} for ${ev.university}: ${outcome}. "${ev.evidence}"`),
        ),
        lastActivityAt: now,
      });
      return ev.event === 'transferred_away'
        ? `🔁 Change agent — ${ev.university}: the student moved to the other agent. Change Agent is still on; turn it off on the profile once handled.`
        : `✅ Change agent — ${ev.university}: the application stays with us. Turn Change Agent off on the profile if nothing else is pending.`;
    }

    // Already flagged for this university and not resolved: just add the note.
    const open = (student.changeAgentLog ?? []).some(
      (e: ChangeAgentLogEntry) => e.university === ev.university && !e.resolvedAt,
    );
    const noteText =
      `Change agent alert from ${ev.from} for ${ev.university}: another agent applied for the student.` +
      `${deadline} "${ev.evidence}"`;
    if (open && student.changeAgentRequired) {
      await ref.update({ adminNotes: FieldValue.arrayUnion(note(noteText)), lastActivityAt: now });
      return `🚨 Change agent — ${ev.university}: already flagged; the new email is noted.${deadline}`;
    }

    const universities = Array.from(new Set([...(student.changeAgentUniversities ?? []), ev.university]));
    const logEntry: ChangeAgentLogEntry = {
      id: `ca-${Date.now()}-email`,
      university: ev.university,
      flaggedAt: now,
      flaggedByName: EMAIL_ACTOR_NAME,
      note: `${ev.from}.${deadline}`,
    };
    await ref.update({
      changeAgentRequired: true,
      changeAgentUniversities: universities,
      hasChangeAgentHistory: true,
      changeAgentLog: FieldValue.arrayUnion(logEntry),
      adminNotes: FieldValue.arrayUnion(note(noteText)),
      lastActivityAt: now,
    });
    await logAiAction({
      source: 'change_agent',
      summary: `Change Agent switched on — ${ev.university}${ev.deadline ? ` (deadline ${ev.deadline})` : ''}`,
      reason: `Email from ${ev.from}: "${ev.evidence}"`,
      studentId,
      studentName: student.name ?? null,
      undo: {
        type: 'change_agent',
        university: ev.university,
        logEntryId: logEntry.id,
        wasRequired: student.changeAgentRequired === true,
        previousUniversities: student.changeAgentUniversities ?? [],
      },
    });

    // The same alerts the profile switch sends: a task + WhatsApp to the assigned employee,
    // WhatsApp to admins and to the departments of the schools involved.
    const studentName = student.name || 'A student';
    const depts = departmentsFor(student, [ev.university]);
    const taskContent = `🚨 URGENT: Change Agent status for ${studentName} (${ev.university}).${deadline} Source: email from ${ev.from}.`;
    const studentUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`;
    const staff = (await db().collection('users').get()).docs.map((d) => ({ id: d.id, ...d.data() }) as User);
    const employee = student.employeeId ? staff.find((u) => u.civilId === student.employeeId) : undefined;

    if (employee) {
      await db().collection('tasks').add({
        authorId: 'email-intake',
        createdBy: 'email-intake',
        recipientId: employee.id,
        recipientIds: [employee.id],
        content: taskContent,
        createdAt: now,
        status: 'new',
        category: 'system',
        replies: [],
      });
      if (employee.phone) {
        await triggerWhatsAppNotification(
          'change_agent_enabled',
          { userName: employee.name, studentName, employeeName: employee.name, messageContent: taskContent, studentUrl },
          employee.phone,
        );
      }
    }
    for (const u of staff) {
      if (!u.phone || u.id === employee?.id) continue;
      const notify = u.role === 'admin' || (u.role === 'department' && !!u.department && depts.includes(u.department));
      if (!notify) continue;
      await triggerWhatsAppNotification(
        'change_agent_enabled',
        { userName: u.name, studentName, employeeName: employee?.name ?? 'Unassigned', messageContent: taskContent, studentUrl },
        u.phone,
      );
    }

    return `🚨 Change agent switched ON — ${ev.university}: another agent applied for the student.${deadline}`;
  } catch (e) {
    console.error('[email-change-agent] failed:', e);
    return `⚠️ Change agent email for ${ev.university} could not be applied — please switch it on by hand.`;
  }
}
