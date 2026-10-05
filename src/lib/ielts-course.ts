// The IELTS courses an employee can register a student for, each with its timing and
// ballroom. An admin sets them on the IELTS Course request type (Request Settings); until
// then the form offers the four courses below, which is what it always offered.
// Safe for the browser: no server imports.

import type { IeltsCourse } from '@/lib/types';

export const DEFAULT_IELTS_COURSES: IeltsCourse[] = [
  { name: 'One week "ielts" In-Person' },
  { name: 'One week "ielts" Online' },
  { name: 'One month "ielts" In-Person' },
  { name: 'One on One class Inperson' },
];

export function ieltsCourses(config?: { courses?: IeltsCourse[] } | null): IeltsCourse[] {
  const set = (config?.courses ?? []).filter((c) => c?.name?.trim());
  return set.length ? set : DEFAULT_IELTS_COURSES;
}

/** "17:00" → "5:00 PM"; null for anything that is not a time. */
export function formatClock(hhmm?: string | null): string | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "5:00 PM – 8:00 PM", or null when the course has no time set. */
export function courseTimingLabel(course: IeltsCourse): string | null {
  const start = formatClock(course.startTime);
  const end = formatClock(course.endTime);
  return start && end ? `${start} – ${end}` : start;
}

/** The chosen course as it is set up now, to keep on the request. */
export function chosenCourse(config: { courses?: IeltsCourse[] } | null | undefined, option: string | undefined) {
  const course = option ? ieltsCourses(config).find((c) => c.name.trim() === option.trim()) ?? null : null;
  return {
    course,
    courseTiming: course ? courseTimingLabel(course) : null,
    courseBallroom: course?.ballroom?.trim() || null,
  };
}
