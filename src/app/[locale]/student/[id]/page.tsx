
import { notFound } from 'next/navigation';

// This file is intentionally designed to return a 404 error.
// It resolves a build-time routing conflict with src/app/[locale]/(app)/student/[id]/page.tsx.
// The (app) directory is a route group, meaning Next.js ignores it for the URL path,
// which caused two files to map to the same /student/[id] URL.
// By explicitly calling notFound(), we remove the ambiguity and allow the build to succeed.
export default function ConflictingStudentIdPage() {
  notFound();
}
