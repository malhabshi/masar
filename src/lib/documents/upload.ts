// Server-side document upload.
//
// The existing /api/upload route only accepts a browser File from a multipart form, so
// nothing server-side (a scheduled job, or the AI assistant) could attach a document.
// Underneath, Firebase Storage only ever needs a Buffer — this module exposes that
// directly and then performs the same Firestore bookkeeping the HTTP route does, so
// documents uploaded this way show up and notify exactly like a manual upload.

import { adminDb, storage } from '@/lib/firebase/admin';
import { triggerDocumentUploadNotification } from '@/lib/actions';
import type { Document as StudentDocument, Student } from '@/lib/types';

/** Hard cap on a single upload. Matches what the UI realistically sends. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

export type UploadStudentDocumentInput = {
  studentId: string;
  /** Original filename including extension, e.g. "passport.pdf". */
  filename: string;
  /** File bytes, either as a Buffer or a base64 string (no data: prefix). */
  content: Buffer | string;
  contentType?: string;
  /** Display name shown in the UI. Defaults to `filename`. */
  customName?: string;
  note?: string;
  /** Which panel the document belongs to; drives which side gets notified. */
  section?: 'employee' | 'admin';
  /** User id recorded as the uploader. */
  uploaderId: string;
  /** Set false to skip the WhatsApp notification (e.g. bulk backfills). */
  notify?: boolean;
  /**
   * Skip the upload when the profile already holds a document with the same original
   * filename and byte size. Used by email intake, where the same offer letter is often
   * mailed more than once — or was already saved by hand.
   */
  skipIfDuplicate?: boolean;
};

export type UploadStudentDocumentResult =
  | { success: true; document: StudentDocument }
  | { success: true; skipped: true; reason: string; existing: StudentDocument }
  | { success: false; error: string };

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};

function guessContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Strips path separators so a filename can never escape its storage prefix. */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'file';
  return base.replace(/[^\w.\- ()\[\]]/g, '_').slice(0, 180) || 'file';
}

function toBuffer(content: Buffer | string): Buffer {
  if (Buffer.isBuffer(content)) return content;
  // Tolerate a data: URI prefix in case a caller passes one through.
  const stripped = content.includes(',') && content.startsWith('data:') ? content.slice(content.indexOf(',') + 1) : content;
  return Buffer.from(stripped, 'base64');
}

/**
 * Upload a document onto a student's profile. Never throws — returns a result object so
 * tool handlers and jobs can report the outcome directly.
 */
export async function uploadStudentDocument(
  input: UploadStudentDocumentInput,
): Promise<UploadStudentDocumentResult> {
  if (!adminDb || !storage) return { success: false, error: 'Server storage is not available.' };

  const filename = sanitizeFilename(input.filename);
  if (!input.studentId) return { success: false, error: 'studentId is required.' };
  if (!filename) return { success: false, error: 'filename is required.' };

  let buffer: Buffer;
  try {
    buffer = toBuffer(input.content);
  } catch {
    return { success: false, error: 'content is not valid base64.' };
  }
  if (buffer.length === 0) return { success: false, error: 'File content is empty.' };
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return {
      success: false,
      error: `File is ${(buffer.length / 1024 / 1024).toFixed(1)} MB, over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
    };
  }

  try {
    const studentRef = adminDb.collection('students').doc(input.studentId);
    const studentSnap = await studentRef.get();
    if (!studentSnap.exists) return { success: false, error: `Student ${input.studentId} not found.` };
    const student = studentSnap.data() as Student;

    if (input.skipIfDuplicate) {
      const existing = (student.documents || []).find(
        (d) => d.originalName === filename && d.size === buffer.length,
      );
      if (existing) {
        return {
          success: true,
          skipped: true,
          reason: `Already on this profile as "${existing.name}" (uploaded ${existing.uploadedAt}).`,
          existing,
        };
      }
    }

    const contentType = input.contentType || guessContentType(filename);
    const filePath = `students/${input.studentId}/${Date.now()}_${filename}`;
    const blob = storage.bucket().file(filePath);
    await blob.save(buffer, { metadata: { contentType } });
    const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    const now = new Date().toISOString();
    const displayName = input.customName?.trim() || filename;
    const section = input.section ?? 'admin';

    const newDocument: StudentDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: displayName,
      originalName: filename,
      size: buffer.length,
      url,
      authorId: input.uploaderId,
      uploadedAt: now,
      isNew: true,
      viewedBy: [input.uploaderId],
      section,
      ...(input.note ? { note: input.note } : {}),
    };

    // Same counter routing as /api/upload: an employee-section upload notifies admins,
    // an admin-section upload notifies the assigned employee.
    const counterUpdate =
      section === 'employee'
        ? {
            newDocumentsForAdmin: (student.newDocumentsForAdmin || 0) + 1,
            newDocsViewedBy: [input.uploaderId],
          }
        : {
            newDocumentsForEmployee: (student.newDocumentsForEmployee || 0) + 1,
            newDocsViewedBy: [input.uploaderId],
          };

    await studentRef.update({
      documents: [...(student.documents || []), newDocument],
      lastActivityAt: now,
      ...counterUpdate,
    });

    if (input.notify !== false) {
      try {
        await triggerDocumentUploadNotification(input.studentId, displayName, input.uploaderId);
      } catch (e) {
        // The document is already saved; a notification failure must not fail the upload.
        console.error('[documents] Notification failed after upload:', e);
      }
    }

    return { success: true, document: newDocument };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
