// Reading a passport for the JotForm page, so the employee checks the details instead of
// typing them.
//
// The earlier attempt used OCR and gave up on anything less than a clean photo — scanned
// PDFs, angled phone shots. The model reads the page itself, MRZ included, and says how
// sure it is; the form is only filled from what it actually read, and the employee is
// always shown what changed so they can check it against the passport in front of them.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from './client';
import { AI_DOC_MODEL } from './config';

export type PassportRead = {
  isPassport: boolean;
  surname: string | null;
  givenNames: string | null;
  dateOfBirth: string | null;
  sex: 'M' | 'F' | null;
  nationality: string | null;
  passportNumber: string | null;
  civilId: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  /** Fields the model could not read with confidence, by name. */
  unsure: string[];
  note: string | null;
};

const SYSTEM = `You read passport photo pages for a Kuwaiti study-abroad agency. Staff use your reading to fill an application form, then check it against the passport.

Call record_passport exactly once.
- Read the printed fields AND the machine-readable zone (MRZ, the two lines of <<< at the bottom). Where they disagree, trust the MRZ for the name, date of birth, sex and passport number.
- surname and givenNames in Latin capitals exactly as on the passport, e.g. surname "ALRASHEED", givenNames "SALEH R S A". Do not translate or reorder.
- Dates as YYYY-MM-DD.
- civilId: the 12-digit Kuwaiti civil number if it is printed on the page (often labelled Civil No.), otherwise null.
- If a field is blurred, cut off or covered, give your best reading and list the field name in unsure. If you cannot read it at all, use null.
- If this is not a passport photo page, set isPassport false and say what it is in note.`;

const TOOL: Anthropic.Tool = {
  name: 'record_passport',
  description: 'Record the fields read from the passport page.',
  input_schema: {
    type: 'object',
    properties: {
      isPassport: { type: 'boolean' },
      surname: { type: ['string', 'null'] },
      givenNames: { type: ['string', 'null'] },
      dateOfBirth: { type: ['string', 'null'] },
      sex: { type: ['string', 'null'], enum: ['M', 'F', null] },
      nationality: { type: ['string', 'null'] },
      passportNumber: { type: ['string', 'null'] },
      civilId: { type: ['string', 'null'] },
      issueDate: { type: ['string', 'null'] },
      expiryDate: { type: ['string', 'null'] },
      unsure: { type: 'array', items: { type: 'string' } },
      note: { type: ['string', 'null'] },
    },
    required: ['isPassport'],
  },
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const date = (v: unknown) => {
  const s = str(v);
  return s && ISO_DATE.test(s) ? s : null;
};

export async function readPassport(bytes: Buffer, mimeType: string): Promise<PassportRead> {
  let source: Anthropic.ContentBlockParam;
  if (mimeType === 'application/pdf') {
    source = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: bytes.toString('base64') } };
  } else if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
    source = {
      type: 'image',
      source: { type: 'base64', media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: bytes.toString('base64') },
    };
  } else {
    throw new Error('Use a photo (JPG or PNG) or a PDF of the passport page.');
  }

  const res = await getAnthropicClient('passport').messages.create({
    model: AI_DOC_MODEL,
    max_tokens: 1500,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    tools: [TOOL],
    messages: [{ role: 'user', content: [source, { type: 'text', text: 'Read this passport page.' }] }],
  });

  const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!use) throw new Error('The passport could not be read. Please type the details.');
  const i = use.input as Record<string, unknown>;

  const civil = str(i.civilId)?.replace(/\D/g, '') ?? null;
  return {
    isPassport: i.isPassport === true,
    surname: str(i.surname)?.toUpperCase() ?? null,
    givenNames: str(i.givenNames)?.toUpperCase() ?? null,
    dateOfBirth: date(i.dateOfBirth),
    sex: i.sex === 'M' || i.sex === 'F' ? i.sex : null,
    nationality: str(i.nationality),
    passportNumber: str(i.passportNumber),
    civilId: civil && civil.length === 12 ? civil : null,
    issueDate: date(i.issueDate),
    expiryDate: date(i.expiryDate),
    unsure: Array.isArray(i.unsure) ? i.unsure.filter((x): x is string => typeof x === 'string') : [],
    note: str(i.note),
  };
}
