'use server';

/**
 * @fileOverview Flow for customizing application questions using AI.
 *
 * - customizeApplicationQuestions - A function that handles the customization of application questions.
 * - CustomizeApplicationQuestionsInput - The input type for the customizeApplicationQuestions function.
 * - CustomizeApplicationQuestionsOutput - The return type for the customizeApplicationQuestions function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const CustomizeApplicationQuestionsInputSchema = z.object({
  existingQuestions: z.array(z.string()).describe('The list of existing application questions.'),
  newRequirements: z.string().describe('The new requirements or information to incorporate into the application questions.'),
});
export type CustomizeApplicationQuestionsInput = z.infer<typeof CustomizeApplicationQuestionsInputSchema>;

const CustomizeApplicationQuestionsOutputSchema = z.object({
  updatedQuestions: z.array(z.string()).describe('The updated list of application questions incorporating the new requirements.'),
});
export type CustomizeApplicationQuestionsOutput = z.infer<typeof CustomizeApplicationQuestionsOutputSchema>;

export async function customizeApplicationQuestions(
  input: CustomizeApplicationQuestionsInput
): Promise<CustomizeApplicationQuestionsOutput> {
  return customizeApplicationQuestionsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'customizeApplicationQuestionsPrompt',
  input: {schema: CustomizeApplicationQuestionsInputSchema},
  output: {schema: CustomizeApplicationQuestionsOutputSchema},
  model: 'googleai/gemini-1.5-flash-latest',
  prompt: `You are an AI assistant designed to help administrators customize application questions for students applying to universities.

The existing application questions are:

{{#each existingQuestions}}
- {{{this}}}
{{/each}}

New requirements or information to incorporate into the application questions:

{{{newRequirements}}}

Based on the existing questions and the new requirements, generate a new list of updated application questions that are comprehensive and tailored to the new requirements.

Ensure that the updated questions cover all necessary information for the application process. Return a JSON array of strings.
`,
});

const customizeApplicationQuestionsFlow = ai.defineFlow(
  {
    name: 'customizeApplicationQuestionsFlow',
    inputSchema: CustomizeApplicationQuestionsInputSchema,
    outputSchema: CustomizeApplicationQuestionsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
