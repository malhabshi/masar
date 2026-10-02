// Naming an emailed document.
//
// Attachments arrive with useless names — "WhatsApp Image 2026-09-01 at 12.12.26 AM.jpeg",
// "Screenshot.png", "2971725-45354094-4-5 NADOUM Asia Kh A H-UK ISC Offer letter.pdf".
// Staff rename them by what the document IS and who it is FROM, e.g.
// "University of Bath - Study Group", "final transcript".
//
// This asks the model to do the same. The original filename is always preserved on the
// document record (`originalName`), so a bad guess is never destructive.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';

const SYSTEM = `You name documents for a Kuwaiti study-abroad agency's student files.

Given an attachment's filename plus the email it arrived in, reply with a SHORT document name and nothing else.

Name it by what the document IS and, when relevant, who it is FROM. House style examples:
- "University of Bath - Offer Letter"
- "University of Strathclyde - Study Group"
- "Passport"
- "Final Transcript"
- "IELTS Certificate"
- "Bank Statement"
- "CAS Letter"
- "Visa Approval"

Rules:
- 2 to 6 words. Title Case.
- Name the institution when the document clearly comes from one (a university, a bank, an exam board, a ministry).
- Do NOT include the student's name — the file already sits on their profile.
- Do NOT include dates, reference numbers, or the file extension.
- If you genuinely cannot tell what it is, reply with exactly: Document
- Reply with the name only. No quotes, no explanation, no trailing full stop.`;

/** Strip anything that would look wrong as a display name. */
function sanitize(name: string): string {
  const cleaned = name
    .replace(/["'`]/g, '')
    .replace(/\.(pdf|png|jpe?g|heic|webp|docx?|csv|txt)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  // A model that ignores instructions and writes a sentence is not a filename.
  if (!cleaned || cleaned.length > 60 || cleaned.split(' ').length > 8) return '';
  return cleaned;
}

/**
 * Work out a human-readable name for an attachment.
 * Falls back to the original filename (minus extension) when AI is unavailable.
 */
export async function nameDocument(input: {
  filename: string;
  contentType: string;
  subject: string;
  body: string;
}): Promise<{ name: string; source: 'ai' | 'fallback' }> {
  const fallback = input.filename.replace(/\.[^.]+$/, '').trim() || 'Document';

  if (!isAiConfigured()) return { name: fallback, source: 'fallback' };

  try {
    const client = getAnthropicClient('email-naming');
    const response = await client.messages.create({
      model: AI_FAST_MODEL,
      max_tokens: 100,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            `Attachment filename: ${input.filename}`,
            `File type: ${input.contentType}`,
            `Email subject: ${input.subject || '(none)'}`,
            `Email body:\n${input.body.replace(/\s+/g, ' ').trim().slice(0, 1500) || '(empty)'}`,
          ].join('\n'),
        },
      ],
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join(' ');

    const name = sanitize(text);
    return name ? { name, source: 'ai' } : { name: fallback, source: 'fallback' };
  } catch (e) {
    console.error('[email-intake] Document naming failed, using filename:', e);
    return { name: fallback, source: 'fallback' };
  }
}
