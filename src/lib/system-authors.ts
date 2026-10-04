// Documents and notes that masar adds itself have an author id with no user record behind
// it. Without a name they read as "Student" or "...", which is wrong.

const SYSTEM_AUTHORS: Record<string, string> = {
  // EMAIL_INTAKE_USER_ID (src/lib/email/intake.ts): filed from an email, or a status set from one.
  'email-intake': 'Email (Masar AI)',
  system: 'masar',
};

/** The display name for an author id that is not a user, or null when it is not one of masar's own. */
export function systemAuthorName(authorId: string | null | undefined): string | null {
  return (authorId && SYSTEM_AUTHORS[authorId]) || null;
}
