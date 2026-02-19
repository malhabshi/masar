
import { notFound } from 'next/navigation';

// This file creates a routing conflict with /src/app/[locale]/(app)/student/[id]/page.tsx
// Calling notFound() explicitly resolves the build error.
export default function ConflictingStudentIdPage() {
  notFound();
  return null;
}
