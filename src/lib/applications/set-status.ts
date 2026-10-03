// Changing one application's status from automatic code (the AI), safely.
//
// updateApplicationStatus (actions.ts) reads the student, edits the applications list and
// writes the whole list back in separate steps, and does not look at the status it is
// replacing — a change staff make in between is lost, and an application staff have just
// marked Accepted can be turned into Rejected. Here the check and the write happen in one
// transaction against the current record: Accepted and Rejected are never replaced. The
// assigned employee is then notified the same way as for a change made by hand.

import { adminDb } from '@/lib/firebase/admin';
import { triggerWhatsAppNotification } from '@/lib/actions';
import type { Application, ApplicationStatus, User } from '@/lib/types';

const FINAL: ApplicationStatus[] = ['Accepted', 'Rejected'];

export type SetStatusResult =
  | { ok: true; from: ApplicationStatus; previousReason: string | null }
  | { ok: false; why: string; status?: ApplicationStatus };

export async function setOpenApplicationStatus(input: {
  studentId: string;
  university: string;
  major: string;
  to: ApplicationStatus;
  rejectionReason?: string;
}): Promise<SetStatusResult> {
  if (!adminDb) return { ok: false, why: 'Database not available.' };
  const ref = adminDb.collection('students').doc(input.studentId);
  const now = new Date().toISOString();

  const outcome = await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.data();
    if (!s) return { ok: false as const, why: 'Student not found.' };
    const apps = (s.applications ?? []) as Application[];
    const i = apps.findIndex((a) => a.university === input.university && a.major === input.major);
    if (i < 0) return { ok: false as const, why: 'That application is no longer on the profile.' };
    const current = apps[i];
    if (FINAL.includes(current.status)) return { ok: false as const, why: `It is ${current.status} now.`, status: current.status };
    if (current.status === input.to) return { ok: false as const, why: `It is already ${input.to}.`, status: current.status };

    const next = apps.map((a, k) => {
      if (k !== i) return a;
      const changed: Application = { ...a, status: input.to, updatedAt: now };
      if (input.to === 'Rejected' && input.rejectionReason) changed.rejectionReason = input.rejectionReason;
      else delete changed.rejectionReason;
      return changed;
    });
    tx.update(ref, { applications: next, lastActivityAt: now });
    return {
      ok: true as const,
      from: current.status,
      previousReason: current.rejectionReason ?? null,
      studentName: String(s.name ?? ''),
      employeeId: (s.employeeId as string | undefined) ?? null,
      apps: next,
    };
  });
  if (!outcome.ok) return outcome;

  // Notify the assigned employee only after the change is committed.
  try {
    if (outcome.employeeId) {
      const q = await adminDb.collection('users').where('civilId', '==', outcome.employeeId).limit(1).get();
      if (!q.empty) {
        const employee = q.docs[0];
        const summary = outcome.apps.map((a) => `- ${a.university}: *${a.status}*`).join('\n') || 'No applications listed.';
        const content = `Status update for ${outcome.studentName}: ${input.university} is now ${input.to}.\n\nFull Summary:\n${summary}`;
        await adminDb.collection('tasks').add({
          authorId: 'system',
          createdBy: 'system',
          recipientId: employee.id,
          recipientIds: [employee.id],
          content,
          createdAt: now,
          status: 'new',
          category: 'system',
          replies: [],
        });
        await triggerWhatsAppNotification(
          'application_status_update',
          {
            employeeName: (employee.data() as User).name,
            studentName: outcome.studentName,
            messageContent: content,
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${input.studentId}`,
          },
          (employee.data() as User).phone,
        );
      }
    }
  } catch (e) {
    console.error('[set-status] notification failed:', e);
  }
  return { ok: true, from: outcome.from, previousReason: outcome.previousReason };
}
