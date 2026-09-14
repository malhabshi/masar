// Detecting a revised document and reporting what changed.
//
// Offer letters get reissued: a university amends the conditions, the deposit deadline
// moves, an English requirement is added. If a revised offer is filed quietly alongside
// the old one, staff act on stale conditions. So when an incoming document looks like a
// newer version of one already on the profile, its text is compared with the old one and
// the differences are stated explicitly in the chat note.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_MODEL, isAiConfigured } from '@/lib/ai/config';
import type { Document as StudentDocument } from '@/lib/types';

/** Extract text from a PDF. Returns null for non-PDFs or unreadable files. */
export async function extractPdfText(buffer: Buffer, contentType: string): Promise<string | null> {
  if (contentType !== 'application/pdf') return null;
  try {
    // Imported lazily: the library pulls in a large PDF engine that should not be
    // loaded for the common case of an image attachment.
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = String(result?.text ?? '').replace(/\s+/g, ' ').trim();
      return text.length > 0 ? text : null;
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (e) {
    console.error('[document-compare] PDF text extraction failed:', e);
    return null;
  }
}

/**
 * Find a document already on the profile that the incoming one appears to supersede.
 * Matches on the generated display name, which is derived from what the document IS
 * ("University of Bath - ISC Offer Letter"), so a reissued offer lands on the same name.
 */
export function findSupersededDocument(
  documents: StudentDocument[],
  newName: string,
): StudentDocument | null {
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const target = norm(newName);
  if (!target) return null;

  const matches = documents.filter((d) => {
    const existing = norm(d.name ?? '');
    if (!existing) return false;
    // Same document name, or one clearly contains the other (e.g. "University of Bath -
    // Study Group" vs "University of Bath - ISC Offer Letter" both being Bath offers).
    return existing === target || existing.includes(target) || target.includes(existing);
  });

  if (matches.length === 0) return null;
  // The most recent one is what staff would currently be working from.
  return matches.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
}

const COMPARE_SYSTEM = `You compare two versions of a student's document for a study-abroad agency and report what CHANGED.

The staff already have the older version and may be acting on it. Your job is to tell them, in a busy work chat, what is different now.

Report only material differences — things that change what someone must DO:
- conditions added, removed or reworded
- deadlines, dates, deposit amounts, fees
- course, campus, intake or start date
- English language requirements
- offer type (conditional vs unconditional)

Ignore cosmetic differences: formatting, reference numbers, letterhead, page numbering, the date the letter was printed.

Reply in ONE of these two forms and nothing else:
- If nothing material changed: NO MATERIAL CHANGE
- Otherwise: up to 4 short bullet lines, each starting with "- ", each naming the old value and the new value where you can.

Never invent a change you cannot see in the text. If one version is unreadable, say: COULD NOT COMPARE`;

export type ComparisonResult = {
  /** True when a materially different, newer version was detected. */
  changed: boolean;
  /** Human-readable summary of the differences, or a reason it could not compare. */
  summary: string;
  comparable: boolean;
};

/** Ask the model what materially changed between two versions of a document. */
export async function compareDocumentVersions(input: {
  documentName: string;
  oldText: string | null;
  newText: string | null;
}): Promise<ComparisonResult> {
  if (!input.oldText || !input.newText) {
    return {
      changed: false,
      comparable: false,
      summary:
        'Could not read one of the versions to compare (not a PDF, or the text could not be extracted). ' +
        'Check the conditions by hand.',
    };
  }
  if (!isAiConfigured()) {
    return { changed: false, comparable: false, summary: 'AI is not configured, so versions were not compared.' };
  }

  try {
    const client = getAnthropicClient();
    const response = await client.messages.create({
      model: AI_MODEL,
      max_tokens: 500,
      system: COMPARE_SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            `Document: ${input.documentName}`,
            '',
            '=== OLDER VERSION (already on file) ===',
            input.oldText.slice(0, 12000),
            '',
            '=== NEWER VERSION (just received) ===',
            input.newText.slice(0, 12000),
          ].join('\n'),
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (/^NO MATERIAL CHANGE/i.test(text)) {
      return { changed: false, comparable: true, summary: 'No material change from the version already on file.' };
    }
    if (/^COULD NOT COMPARE/i.test(text)) {
      return { changed: false, comparable: false, summary: 'The two versions could not be compared — check by hand.' };
    }
    return { changed: true, comparable: true, summary: text };
  } catch (e) {
    console.error('[document-compare] Comparison failed:', e);
    return { changed: false, comparable: false, summary: 'Version comparison failed — check the conditions by hand.' };
  }
}
