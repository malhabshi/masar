// Reading the CONTENT of a student's documents over MCP.
//
// get_student hands back each document's storage URL, but an MCP client cannot open a
// URL that came out of a tool result — so offer letters, CAS letters and passports were
// visible by name only. These tools fetch the bytes server-side (the same service
// account that signs those URLs can read the objects) and return something the model can
// actually use: extracted text for PDFs, the image itself for photos and scans.
//
// Only documents recorded on the student's own profile can be read; the storage path is
// always derived from that record, never taken from the caller.
import { adminDb, storage } from '@/lib/firebase/admin';

const BUCKET = 'studio-9484431255-91d96.firebasestorage.app';

/** Offer letters and CAS letters run to a few pages; this is a guard, not a budget. */
export const MAX_TEXT_CHARS = 30_000;
/** Images are returned inline, so they have to stay inside a sane response size. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
/** Non-text, non-image files (a handful of .docx) are passed through only if small. */
export const MAX_RAW_BYTES = 1024 * 1024;
/** Below this much extracted text a PDF is almost certainly a scan with no text layer. */
const SCAN_TEXT_THRESHOLD = 40;

export interface StudentDocumentSummary {
  documentId: string;
  name: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number | null;
  uploadedAt: string | null;
  section: string | null;
  readable: boolean;
}

export interface ReadDocumentResult {
  documentId: string;
  name: string;
  originalName: string;
  mimeType: string;
  encoding: 'text' | 'base64';
  content: string;
  sizeBytes: number;
  pageCount?: number;
  truncated?: boolean;
  scanned?: boolean;
  note?: string;
  /** Set for images. The handler emits these bytes as an MCP image block and then
   *  removes the field, so the base64 is never also repeated as JSON text. */
  imageBlock?: { base64: string; mimeType: string };
}

interface StoredDocument {
  id?: string;
  name?: string;
  originalName?: string;
  url?: string;
  size?: number;
  uploadedAt?: string;
  section?: string;
}

const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function mimeFromName(name: string): string {
  const ext = (name.match(/\.([A-Za-z0-9]{1,5})$/)?.[1] || '').toLowerCase();
  return EXT_MIME[ext] || 'application/octet-stream';
}

/**
 * The object path inside the bucket, from whichever URL shape the record holds.
 *
 * Two are in use: signed `storage.googleapis.com/<bucket>/<path>` URLs (most documents)
 * and Firebase download `firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded path>`
 * URLs (JotForm-era uploads). `gs://` is accepted too. Returns null for anything else
 * rather than guessing, so a malformed record fails loudly instead of reading the wrong
 * object.
 */
export function storagePathFromUrl(raw: string | undefined, bucket = BUCKET): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol === 'gs:') {
    const full = `${u.hostname}${u.pathname}`;
    return full.startsWith(`${bucket}/`) ? decodeURIComponent(full.slice(bucket.length + 1)) : null;
  }
  if (u.hostname === 'firebasestorage.googleapis.com') {
    const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    return m && m[1] === bucket ? decodeURIComponent(m[2]) : null;
  }
  if (u.hostname === 'storage.googleapis.com') {
    const p = u.pathname.replace(/^\//, '');
    return p.startsWith(`${bucket}/`) ? decodeURIComponent(p.slice(bucket.length + 1)) : null;
  }
  return null;
}

async function loadStudentDocuments(studentId: string): Promise<StoredDocument[]> {
  if (!adminDb) throw new Error('Database is not available.');
  const snap = await adminDb.collection('students').doc(studentId).get();
  if (!snap.exists) throw new Error(`Student ${studentId} not found.`);
  const data = snap.data() as { documents?: StoredDocument[] } | undefined;
  return data?.documents || [];
}

/**
 * The documents on a student's profile, without the storage URLs.
 *
 * `readable` says whether read_student_document can return usable content for it:
 * true for PDFs, images and plain text, false for the few Word/Excel attachments.
 */
export async function listStudentDocuments(studentId: string) {
  const docs = await loadStudentDocuments(studentId);
  const documents: StudentDocumentSummary[] = docs.map((d, i) => {
    const originalName = d.originalName || d.name || '';
    const mimeType = mimeFromName(originalName || d.name || '');
    return {
      documentId: d.id || `index-${i}`,
      name: d.name || originalName || 'Untitled',
      originalName,
      mimeType,
      sizeBytes: typeof d.size === 'number' ? d.size : null,
      uploadedAt: d.uploadedAt || null,
      section: d.section || null,
      readable: mimeType === 'application/pdf' || mimeType.startsWith('image/') || mimeType.startsWith('text/'),
    };
  });
  return { studentId, count: documents.length, documents };
}

/** Page text via pdfjs, which is pure JavaScript — no native canvas build to deploy. */
async function extractPdfText(bytes: Buffer): Promise<{ text: string; pageCount: number }> {
  // Loaded on demand: pdfjs is large, and nothing else in the app needs it.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  }).promise;

  const pages: string[] = [];
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '';
      let lastY: number | null = null;
      const lines: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5] as number;
        if (lastY !== null && Math.abs(y - lastY) > 2) {
          lines.push(line.trimEnd());
          line = '';
        }
        line += item.str;
        if (item.hasEOL) {
          lines.push(line.trimEnd());
          line = '';
        }
        lastY = y;
      }
      lines.push(line.trimEnd());
      pages.push(lines.filter(l => l.length > 0).join('\n'));
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }

  return { text: pages.join('\n\n').trim(), pageCount: doc.numPages };
}

/**
 * Fetch one document belonging to one student and return its content.
 *
 * PDFs come back as extracted text, images as bytes for an MCP image block, plain text
 * as itself. A scanned PDF has no text layer to extract, and this runs without a
 * rasterizer, so it is reported as such rather than returned as unreadable bytes.
 */
export async function readStudentDocument(studentId: string, documentId: string): Promise<ReadDocumentResult> {
  if (!storage) throw new Error('Storage is not available.');
  const docs = await loadStudentDocuments(studentId);
  const record = docs.find((d, i) => (d.id || `index-${i}`) === documentId);
  if (!record) {
    throw new Error(`Document ${documentId} is not on student ${studentId}. Call list_student_documents for the available ids.`);
  }

  const path = storagePathFromUrl(record.url);
  if (!path) throw new Error(`Document ${documentId} has no readable storage URL on file.`);

  const file = storage.bucket(BUCKET).file(path);
  const [exists] = await file.exists();
  if (!exists) throw new Error(`The stored file for ${documentId} is missing from the bucket (${path}).`);

  const [metadata] = await file.getMetadata();
  const originalName = record.originalName || record.name || '';
  const mimeType = (metadata.contentType && metadata.contentType !== 'application/octet-stream'
    ? metadata.contentType
    : mimeFromName(originalName)) || 'application/octet-stream';
  const sizeBytes = Number(metadata.size) || record.size || 0;

  const base = {
    documentId,
    name: record.name || originalName || 'Untitled',
    originalName,
    mimeType,
    sizeBytes,
  };

  if (mimeType.startsWith('image/')) {
    if (sizeBytes > MAX_IMAGE_BYTES) {
      return {
        ...base,
        encoding: 'base64',
        content: '',
        note: `Image is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB inline limit, so it was not fetched.`,
      };
    }
    const [bytes] = await file.download();
    return {
      ...base,
      encoding: 'base64',
      content: '',
      note: 'Image bytes are attached as an image block on this result, not as text in this JSON.',
      imageBlock: { base64: bytes.toString('base64'), mimeType },
    };
  }

  if (mimeType === 'application/pdf') {
    const [bytes] = await file.download();
    let text = '';
    let pageCount: number | undefined;
    try {
      const out = await extractPdfText(bytes);
      text = out.text;
      pageCount = out.pageCount;
    } catch (e) {
      return {
        ...base,
        encoding: 'text',
        content: '',
        note: `Could not read this PDF: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (text.length < SCAN_TEXT_THRESHOLD) {
      return {
        ...base,
        encoding: 'text',
        content: text,
        pageCount,
        scanned: true,
        note: 'This PDF has no text layer — it is a scan or a set of page images. Text extraction is not possible here; open the document in the website to view it.',
      };
    }

    const truncated = text.length > MAX_TEXT_CHARS;
    return {
      ...base,
      encoding: 'text',
      content: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated at ${MAX_TEXT_CHARS} characters]` : text,
      pageCount,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  if (mimeType.startsWith('text/') || mimeType === 'application/json') {
    const [bytes] = await file.download();
    const text = bytes.toString('utf8');
    const truncated = text.length > MAX_TEXT_CHARS;
    return {
      ...base,
      encoding: 'text',
      content: truncated ? `${text.slice(0, MAX_TEXT_CHARS)}\n\n[truncated at ${MAX_TEXT_CHARS} characters]` : text,
      ...(truncated ? { truncated: true } : {}),
    };
  }

  // Word/Excel and anything else: there is no extractor here, so hand back the bytes
  // only when they are small enough to be worth carrying.
  if (sizeBytes > MAX_RAW_BYTES) {
    return {
      ...base,
      encoding: 'base64',
      content: '',
      note: `No text extractor for ${mimeType}, and the file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB — too large to return raw. Open it in the website instead.`,
    };
  }
  const [bytes] = await file.download();
  return {
    ...base,
    encoding: 'base64',
    content: bytes.toString('base64'),
    note: `No text extractor for ${mimeType}; raw bytes returned base64-encoded.`,
  };
}
