// Every Saturday at 20:00 Kuwait time the owner gets an Excel file of the students registered
// for an IELTS course that starts the next day, Sunday — the admin, 2026-10-10. Only the
// columns asked for: Student Name, Phone Number, Email, Course Type, Exam Date.
//
// Run from the five-minute cron. Sent once per Sunday (app_settings/ielts_weekly_report);
// when 20:00 is missed it goes at the next run before midnight. A registration replaced by
// a newer one for the same day, or denied, is left out, and so is a student whose profile is
// closed (the admin, 2026-10-10).

import nodemailer from 'nodemailer';
import * as XLSX from 'xlsx';
import { adminDb } from '@/lib/firebase/admin';
import { kuwaitDay } from '@/lib/ielts-course-registration';

const STATE = { collection: 'app_settings', doc: 'ielts_weekly_report' };
const SEND_HOUR = 20;
const KUWAIT_OFFSET_MS = 3 * 3_600_000;
const HEADERS = ['Student Name', 'Phone Number', 'Email', 'Course Type', 'Exam Date'];

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const longDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** The rows for one Sunday (YYYY-MM-DD, Kuwait), by course then name. */
export async function ieltsRowsFor(day: string): Promise<string[][]> {
  const snap = await db().collection('tasks').where('data.examType', '==', 'ielts_course').get();
  const regs = snap.docs
    .map((d) => d.data())
    .filter((t) => !t.replacedBy && t.status !== 'denied' && kuwaitDay(t.data?.courseStartDate) === day);
  // Closed profiles: the flag, or "-Closed" on the name.
  const ids = [...new Set(regs.map((t) => String(t.studentId ?? '')).filter(Boolean))];
  const students = ids.length ? await db().getAll(...ids.map((id) => db().collection('students').doc(id))) : [];
  const closed = new Set(
    students.filter((s) => s.data()?.isClosed === true || /-\s*closed\s*$/i.test(String(s.data()?.name ?? ''))).map((s) => s.id),
  );
  return regs
    .filter((t) => !closed.has(String(t.studentId ?? '')))
    .map((t) => [
      String(t.studentName ?? t.data?.studentName ?? '').trim(),
      String(t.studentPhone ?? t.data?.studentPhone ?? '').trim(),
      String(t.data?.studentEmail ?? '').trim(),
      String(t.data?.courseOption ?? '').trim(),
      day,
    ])
    .sort((a, b) => a[3].localeCompare(b[3]) || a[0].localeCompare(b[0]));
}

/** The Excel file: one sheet, the five columns. */
export function ieltsWorkbook(rows: string[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  sheet['!cols'] = [{ wch: 36 }, { wch: 15 }, { wch: 34 }, { wch: 28 }, { wch: 12 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'IELTS Course');
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Build and email the file for that Sunday to the owner. */
export async function sendIeltsWeekly(day: string): Promise<{ to: string; students: number }> {
  const ownerId = process.env.MCP_OWNER_USER_ID?.trim();
  const to = ownerId ? String((await db().collection('users').doc(ownerId).get()).data()?.email ?? '').trim() : '';
  const mailbox = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  if (!to) throw new Error('The owner has no email address (MCP_OWNER_USER_ID).');
  if (!mailbox || !password) throw new Error('The mailbox is not configured.');

  const rows = await ieltsRowsFor(day);
  const when = longDate(day);
  await nodemailer
    .createTransport({ host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com', port: 465, secure: true, auth: { user: mailbox, pass: password } })
    .sendMail({
      from: mailbox,
      to,
      subject: `IELTS Course — ${when} (${rows.length} student${rows.length === 1 ? '' : 's'})`,
      text: rows.length
        ? `Attached: the ${rows.length} student${rows.length === 1 ? '' : 's'} registered for an IELTS course starting ${when}.`
        : `No student is registered for an IELTS course starting ${when}. The attached file has the columns only.`,
      attachments: [{ filename: `IELTS Course - ${day}.xlsx`, content: ieltsWorkbook(rows) }],
      // Staff mail: the sent-mail sync leaves it out of every student's email memory.
      headers: { 'X-Masar-Internal': 'ielts-weekly-report' },
    });
  return { to, students: rows.length };
}

/** The Sunday to report on: the next day, on Saturday from 20:00 Kuwait; otherwise null. */
export function dueSunday(now = Date.now()): string | null {
  const k = new Date(now + KUWAIT_OFFSET_MS);
  if (k.getUTCDay() !== 6 || k.getUTCHours() < SEND_HOUR) return null;
  return new Date(k.getTime() + 86_400_000).toISOString().slice(0, 10);
}

/** From the cron: on Saturday from 20:00 Kuwait, once for the next day. */
export async function ieltsWeeklyIfDue(now = Date.now()) {
  const sunday = dueSunday(now);
  if (!sunday) return { skipped: 'only Saturday from 20:00 Kuwait' };
  const ref = db().collection(STATE.collection).doc(STATE.doc);
  // Claimed first, so two runs at once send it once; given back if the email fails.
  const claimed = await db().runTransaction(async (tx) => {
    const s = (await tx.get(ref)).data();
    if (s?.sentFor === sunday || (s?.sendingFor === sunday && Date.now() - Date.parse(s.sendingAt ?? '') < 10 * 60_000)) return false;
    tx.set(ref, { sendingFor: sunday, sendingAt: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!claimed) return { skipped: `already sent for ${sunday}` };
  try {
    const r = await sendIeltsWeekly(sunday);
    await ref.set({ sentFor: sunday, sentAt: new Date().toISOString(), sentTo: r.to, students: r.students, sendingFor: null }, { merge: true });
    return { sentFor: sunday, ...r };
  } catch (e) {
    await ref.set({ sendingFor: null, lastError: e instanceof Error ? e.message : String(e) }, { merge: true });
    throw e;
  }
}
