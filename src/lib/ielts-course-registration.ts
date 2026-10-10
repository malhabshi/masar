// When an employee registers a student for an IELTS course: a reminder on the student's
// page for when the course starts, and an email with every detail, sent at once
// from the agency mailbox to the employee who registered. Called by createStudentTask.
// Server only — kept out of actions.ts, whose exports any browser can call.
//
// Registering a student again for a course that starts the same day is a change, not a
// second course: the earlier registration for that day is marked replaced (the dashboard
// shows only the new one, with what it was before) and its reminder is turned off. Talal
// moved Rawan and Haya from In-Person to Online on 5 Oct and both stayed, contradicting each
// other (the admin, 2026-10-10). A one-on-one class and a group course are separate — a
// few students take both from the same day.

import nodemailer from 'nodemailer';
import { adminDb } from '@/lib/firebase/admin';
import { formatKuwaitTime } from '@/lib/timestamp-utils';
import type { IeltsCourse, Student, User } from '@/lib/types';

const DAY_MS = 86_400_000;
const KUWAIT_OFFSET_MS = 3 * 3_600_000;

/**
 * The start date as a Kuwait calendar day. The form sends midnight of the picked day in the
 * browser's time zone; rounding to the nearest Kuwait midnight gives the day picked.
 */
function kuwaitDay(value: unknown): string | null {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === 'string'
        ? Date.parse(value)
        : typeof (value as { toDate?: () => Date })?.toDate === 'function'
          ? (value as { toDate: () => Date }).toDate().getTime()
          : NaN;
  if (Number.isNaN(ms)) return null;
  return new Date(Math.round((ms + KUWAIT_OFFSET_MS) / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

function longDate(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export type CourseRegistrationResult = {
  reminderId: string | null;
  /** Earlier registrations for the same start day that this one replaced. */
  replaced?: Array<{ taskId: string; option: string; registeredAt: string }>;
  emailedTo: string | null;
  emailedAt: string | null;
  error: string | null;
  /** With dryRun: what would be saved and sent. */
  preview?: { reminder: Record<string, unknown> | null; email: { to: string; subject: string; text: string } | null };
};

const isIeltsCourse = (t: Record<string, any>) => t.data?.examType === 'ielts_course' || String(t.taskType ?? '').toLowerCase() === 'ielts course';
const oneOnOne = (option: unknown) => /one\s*on\s*one/i.test(String(option ?? ''));

/**
 * Mark the student's earlier registrations for the same start day (and the same kind of
 * course) replaced by this one, and turn off their reminders.
 */
async function replaceEarlier(input: { taskId: string; studentId: string; day: string; option: string; dryRun?: boolean }) {
  if (!adminDb) return [];
  const snap = await adminDb.collection('tasks').where('studentId', '==', input.studentId).get();
  const earlier = snap.docs.filter((d) => {
    const t = d.data();
    return (
      d.id !== input.taskId &&
      isIeltsCourse(t) &&
      !t.replacedBy &&
      t.status !== 'denied' &&
      kuwaitDay(t.data?.courseStartDate) === input.day &&
      oneOnOne(t.data?.courseOption) === oneOnOne(input.option)
    );
  });
  const out: Array<{ taskId: string; option: string; registeredAt: string }> = [];
  for (const d of earlier) {
    const t = d.data();
    out.push({ taskId: d.id, option: String(t.data?.courseOption ?? ''), registeredAt: String(t.createdAt ?? '') });
    if (input.dryRun) continue;
    const at = new Date().toISOString();
    await d.ref.update({ replacedBy: input.taskId, replacedAt: at });
    const reminders = await adminDb.collection('student_reminders').where('ieltsCourseTaskId', '==', d.id).get();
    await Promise.all(reminders.docs.filter((r) => r.data().status === 'active').map((r) => r.ref.update({ status: 'dismissed', dismissedAt: at, dismissedReason: 'IELTS course registration replaced' })));
  }
  return out;
}

/** Never throws: the registration itself is already saved, whatever happens here. */
export async function afterIeltsCourseRegistration(input: {
  taskId: string;
  studentId: string;
  student: Student;
  registeredBy: User | null;
  option: string;
  course: IeltsCourse | null;
  courseTiming: string | null;
  courseBallroom: string | null;
  courseStartDate: unknown;
  notes?: string;
  /** Build the reminder and the email without saving or sending either. */
  dryRun?: boolean;
}): Promise<CourseRegistrationResult> {
  const result: CourseRegistrationResult = { reminderId: null, emailedTo: null, emailedAt: null, error: null };
  const preview: NonNullable<CourseRegistrationResult['preview']> = { reminder: null, email: null };
  if (!adminDb) return { ...result, error: 'Database not available.' };
  const errors: string[] = [];
  const day = kuwaitDay(input.courseStartDate);
  const starts = day ? longDate(day) : 'date not given';
  const online = /online/i.test(input.option);
  const place = input.courseBallroom ?? (online ? 'Online' : null);
  const by = input.registeredBy;
  const byName = by?.name?.trim() || 'Staff';
  const studentName = input.student.name?.trim() ?? '';
  const studentUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${input.studentId}`;

  const replaced = day
    ? await replaceEarlier({ taskId: input.taskId, studentId: input.studentId, day, option: input.option, dryRun: input.dryRun }).catch((e) => {
        errors.push(`replacing the earlier registration: ${e instanceof Error ? e.message : String(e)}`);
        return [];
      })
    : [];
  if (replaced.length) result.replaced = replaced;
  const changedFrom = replaced.length
    ? `Replaces the earlier registration: ${replaced.map((r) => `${r.option} (registered ${r.registeredAt.slice(0, 10)})`).join('; ')}`
    : null;

  const details = [
    `Course: ${input.option}`,
    `Starts: ${starts}`,
    `Timing: ${input.courseTiming ?? 'not set yet'}`,
    `Ballroom: ${place ?? 'not set yet'}`,
  ];

  // The reminder: due when the course starts (09:00 when the course has no time set),
  // for the employee who registered. In-app only — the email below is the announcement.
  if (day && by) {
    try {
      const time = /^\d{1,2}:\d{2}$/.test(input.course?.startTime ?? '') ? input.course!.startTime!.padStart(5, '0') : '09:00';
      const reminder = {
        studentId: input.studentId,
        studentName: input.student.name,
        title: `IELTS course starts: ${input.option}`,
        description: [...details.slice(1), `Registered by ${byName}`].join('\n'),
        location: place,
        dueAt: new Date(`${day}T${time}:00+03:00`).toISOString(),
        recipientType: 'custom',
        recipientUserIds: [by.id],
        studentEmployeeId: input.student.employeeId ?? null,
        createdBy: by.id,
        createdByName: byName,
        createdAt: new Date().toISOString(),
        status: 'active',
        notifyWhatsApp: false,
        ieltsCourseTaskId: input.taskId,
      };
      if (input.dryRun) preview.reminder = reminder;
      else result.reminderId = (await adminDb.collection('student_reminders').add(reminder)).id;
    } catch (e) {
      errors.push(`reminder: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const mailbox = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!by?.email) errors.push('email: the employee who registered has no email address');
  else if (!mailbox || !password) errors.push('email: the mailbox is not configured');
  else {
    try {
      const text = [
        `Hello ${byName},`,
        '',
        `${studentName} is registered for an IELTS course.`,
        '',
        `Student: ${studentName}`,
        `Phone: ${input.student.phone || '—'}`,
        `Email: ${input.student.email || '—'}`,
        ...details,
        ...(input.notes?.trim() ? [`Notes: ${input.notes.trim()}`] : []),
        `Registered by: ${byName}, ${formatKuwaitTime(new Date().toISOString())}`,
        ...(changedFrom ? [changedFrom] : []),
        '',
        result.reminderId || preview.reminder ? `A reminder for the start is on the student's page: ${studentUrl}` : `Student page: ${studentUrl}`,
        '',
        'Kind regards,',
        'MMohammed',
      ].join('\n');
      const subject = `IELTS course registration: ${studentName} — ${input.option}, ${starts}`;
      if (input.dryRun) preview.email = { to: by.email, subject, text };
      else {
        await nodemailer
          .createTransport({
            host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com',
            port: 465,
            secure: true,
            auth: { user: mailbox, pass: password },
          })
          .sendMail({
            from: mailbox,
            to: by.email,
            subject,
            text,
            // Staff mail, not mail with a school: the sent-mail sync leaves it out of the
            // student's email memory.
            headers: { 'X-Masar-Internal': 'ielts-course-registration' },
          });
        result.emailedTo = by.email;
        result.emailedAt = new Date().toISOString();
      }
    } catch (e) {
      errors.push(`email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  result.error = errors.length ? errors.join('; ') : null;
  if (input.dryRun) return { ...result, preview };
  if (result.error) console.error('[ielts-course] after registration:', result.error);
  await adminDb
    .collection('tasks')
    .doc(input.taskId)
    .update({ ieltsCourseRegistration: result })
    .catch((e) => console.error('[ielts-course] could not record the result:', e));
  return result;
}
