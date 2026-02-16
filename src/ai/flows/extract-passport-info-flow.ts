'use server';
/**
 * @fileOverview A flow for extracting information from a passport image.
 *
 * - extractPassportInfo - A function that handles the passport info extraction process.
 * - ExtractPassportInfoInput - The input type for the extractPassportInfo function.
 * - ExtractPassportInfoOutput - The return type for the extractPassportInfo function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const ExtractPassportInfoInputSchema = z.object({
  passportImageUri: z
    .string()
    .describe(
      "A photo of a passport, as a data URI that must include a MIME type and use Base64 encoding. Expected format: 'data:<mimetype>;base64,<encoded_data>'."
    ),
});
export type ExtractPassportInfoInput = z.infer<typeof ExtractPassportInfoInputSchema>;

const ExtractPassportInfoOutputSchema = z.object({
  firstName: z.string().describe('The first name of the passport holder.'),
  lastName: z.string().describe('The last name of the passport holder.'),
  dateOfBirth: z.string().describe('The date of birth in YYYY-MM-DD format.'),
  passportNumber: z.string().describe('The passport number.'),
  nationality: z.string().describe('The nationality of the passport holder.'),
  expiryDate: z.string().describe('The passport expiry date in YYYY-MM-DD format.'),
});
export type ExtractPassportInfoOutput = z.infer<typeof ExtractPassportInfoOutputSchema>;

export async function extractPassportInfo(input: ExtractPassportInfoInput): Promise<ExtractPassportInfoOutput> {
  return extractPassportInfoFlow(input);
}

const prompt = ai.definePrompt({
  name: 'extractPassportInfoPrompt',
  input: {schema: ExtractPassportInfoInputSchema},
  output: {schema: ExtractPassportInfoOutputSchema},
  model: 'googleai/gemini-1.5-pro-latest',
  prompt: `You are a highly accurate data extraction tool. Your task is to extract specific fields from the provided passport image.

**Extraction Targets:**
- First Name (or Given Names)
- Last Name (or Surname)
- Date of Birth
- Passport Number
- Nationality
- Expiry Date

**Instructions:**
1.  Analyze the provided image of the passport's machine-readable zone (MRZ) and the main identity page.
2.  Carefully identify the labels and values for each of the targets listed above.
3.  Extract the information exactly as it appears.
4.  Format dates as YYYY-MM-DD.
5.  Return the extracted information in a structured JSON format. If a field cannot be found or is illegible, return an empty string for that field.

Document to analyze:
{{media url=passportImageUri}}
`,
});

const extractPassportInfoFlow = ai.defineFlow(
  {
    name: 'extractPassportInfoFlow',
    inputSchema: ExtractPassportInfoInputSchema,
    outputSchema: ExtractPassportInfoOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
