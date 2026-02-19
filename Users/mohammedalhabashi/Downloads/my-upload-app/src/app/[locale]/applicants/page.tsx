
import { notFound } from 'next/navigation';

// This file creates a routing conflict with /src/app/[locale]/(app)/applicants/page.tsx
// Calling notFound() explicitly resolves the build error.
export default function ConflictingApplicantsPage() {
  notFound();
  return null;
}
