// Settings for email document intake.
//
// `restrictToStudentId` is the safety catch for trying this out on live mail: while it is
// set, ONLY emails identified as that student are touched. Everything else is left
// completely alone — not filed, not queued, and crucially not marked as read — so the
// rest of the mailbox is untouched and nothing is consumed during a test.

import { adminDb } from '@/lib/firebase/admin';

const SETTINGS = { collection: 'app_settings', doc: 'email_intake' };

export type IntakeSettings = {
  /** Only process mail for this student id. null = process everyone. */
  restrictToStudentId: string | null;
  /** Display name of the restricted student, for the UI. */
  restrictToStudentName: string | null;
  /** Let the AI rename attachments by what they are. */
  aiRenameDocuments: boolean;
  /** Announce identified emails in the student's internal chat. */
  postToChat: boolean;
};

export const DEFAULT_INTAKE_SETTINGS: IntakeSettings = {
  restrictToStudentId: null,
  restrictToStudentName: null,
  aiRenameDocuments: true,
  postToChat: true,
};

export async function getIntakeSettings(): Promise<IntakeSettings> {
  if (!adminDb) return DEFAULT_INTAKE_SETTINGS;
  try {
    const snap = await adminDb.collection(SETTINGS.collection).doc(SETTINGS.doc).get();
    if (!snap.exists) return DEFAULT_INTAKE_SETTINGS;
    const d = snap.data() ?? {};
    return {
      restrictToStudentId:
        typeof d.restrictToStudentId === 'string' && d.restrictToStudentId ? d.restrictToStudentId : null,
      restrictToStudentName:
        typeof d.restrictToStudentName === 'string' && d.restrictToStudentName ? d.restrictToStudentName : null,
      aiRenameDocuments: d.aiRenameDocuments !== false,
      postToChat: d.postToChat !== false,
    };
  } catch {
    return DEFAULT_INTAKE_SETTINGS;
  }
}

export async function saveIntakeSettings(patch: Partial<IntakeSettings>): Promise<IntakeSettings> {
  if (!adminDb) throw new Error('Database not available');
  const current = await getIntakeSettings();
  const next: IntakeSettings = {
    restrictToStudentId:
      patch.restrictToStudentId === undefined ? current.restrictToStudentId : patch.restrictToStudentId || null,
    restrictToStudentName:
      patch.restrictToStudentName === undefined
        ? current.restrictToStudentName
        : patch.restrictToStudentName || null,
    aiRenameDocuments:
      typeof patch.aiRenameDocuments === 'boolean' ? patch.aiRenameDocuments : current.aiRenameDocuments,
    postToChat: typeof patch.postToChat === 'boolean' ? patch.postToChat : current.postToChat,
  };
  await adminDb
    .collection(SETTINGS.collection)
    .doc(SETTINGS.doc)
    .set({ ...next, updatedAt: new Date().toISOString() }, { merge: true });
  return next;
}
