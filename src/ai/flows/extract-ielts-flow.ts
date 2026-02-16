'use server';
/**
 * @fileOverview A flow for extracting IELTS scores from a PDF document.
 *
 * - extractIeltsScores - A function that handles the IELTS score extraction process.
 * - ExtractIeltsInput - The input type for the extractIeltsScores function.
 * - ExtractIeltsOutput - The return type for the extractIeltsScores function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractIeltsInputSchema = z.object({
  pdfDataUri: z
    .string()
    .describe(
      "An IELTS Test Report Form as a PDF file, provided as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:application/pdf;base64,<encoded_data>'."
    ),
});
export type ExtractIeltsInput = z.infer<typeof ExtractIeltsInputSchema>;

const ExtractIeltsOutputSchema = z.object({
  listening: z.coerce.number().describe('The Listening band score.'),
  reading: z.coerce.number().describe('The Reading band score.'),
  writing: z.coerce.number().describe('The Writing band score.'),
  speaking: z.coerce.number().describe('The Speaking band score.'),
  overall: z.coerce.number().describe('The Overall Band Score.'),
});
export type ExtractIeltsOutput = z.infer<typeof ExtractIeltsOutputSchema>;

export async function extractIeltsScores(input: ExtractIeltsInput): Promise<ExtractIeltsOutput> {
  return extractIeltsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractIeltsPrompt',
  input: {schema: ExtractIeltsInputSchema},
  output: {schema: ExtractIeltsOutputSchema},
  model: 'googleai/gemini-1.5-pro-latest',
  prompt: `You are an advanced data extraction tool. Your task is to extract specific numeric scores from the provided IELTS Test Report Form PDF.

**Extraction Targets:**
You must find the following labels in the document and return the corresponding numerical band score.
- "Listening"
- "Reading"
- "Writing"
- "Speaking"
- "Overall Band Score"

**Instructions:**
1.  Scan the document for the exact text labels listed above.
2.  For each label, extract the associated score. This score will be a number, potentially with a decimal (e.g., 7.0, 8.5).
3.  **Accuracy is paramount.** Do not guess or infer any values. If a score is not clearly present next to its label, use \`0\` for that field.
4.  Return the extracted scores as a JSON object that matches the required output schema. Ensure all returned values are numbers.

**Example:**
If the document contains "Listening   8.5", you should extract \`8.5\` for the \`listening\` field.

Document to analyze:
{{media url=pdfDataUri}}
`,
});

const extractIeltsFlow = ai.defineFlow(
  {
    name: 'extractIeltsFlow',
    inputSchema: ExtractIeltsInputSchema,
    outputSchema: ExtractIeltsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
