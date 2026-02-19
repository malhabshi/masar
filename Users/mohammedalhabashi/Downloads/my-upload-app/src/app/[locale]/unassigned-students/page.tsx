
import { notFound } from 'next/navigation';

// This file creates a routing conflict with /src/app/[locale]/(app)/unassigned-students/page.tsx
// Calling notFound() explicitly resolves the build error.
export default function ConflictingUnassignedStudentsPage() {
  notFound();
  return null;
}
