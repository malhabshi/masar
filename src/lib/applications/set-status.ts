// Telling the assigned employee about an application status the AI changed — the same task
// and WhatsApp message as for a change made by hand (updateApplicationStatus in actions.ts,
// which cannot be shared from that 'use server' file without exposing it to browsers).

import { adminDb } from '@/lib/firebase/admin';
import { triggerWhatsAppNotification } from '@/lib/actions';
import type { Application, ApplicationStatus, User } from '@/lib/types';

/** Tell the assigned employee, as for a change made by hand. Call only after the change is committed. Never throws. */
export async function notifyEmployeeOfStatus(input: {
  studentId: string;
  studentName: string;
  employeeId: string | null;
  university: string;
  to: ApplicationStatus;
  applications: Application[];
}): Promise<void> {
  if (!adminDb || !input.employeeId) return;
  try {
    const q = await adminDb.collection('users').where('civilId', '==', input.employeeId).limit(1).get();
    if (q.empty) return;
    const employee = q.docs[0];
    const summary = input.applications.map((a) => `- ${a.university}: *${a.status}*`).join('\n') || 'No applications listed.';
    const content = `Status update for ${input.studentName}: ${input.university} is now ${input.to}.\n\nFull Summary:\n${summary}`;
    await adminDb.collection('tasks').add({
      authorId: 'system',
      createdBy: 'system',
      recipientId: employee.id,
      recipientIds: [employee.id],
      content,
      createdAt: new Date().toISOString(),
      status: 'new',
      category: 'system',
      replies: [],
    });
    await triggerWhatsAppNotification(
      'application_status_update',
      {
        employeeName: (employee.data() as User).name,
        studentName: input.studentName,
        messageContent: content,
        studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${input.studentId}`,
      },
      (employee.data() as User).phone,
    );
  } catch (e) {
    console.error('[set-status] notification failed:', e);
  }
}
