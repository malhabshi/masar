// The cheap first look at an email.
//
// Every identified email used to go through several Sonnet calls: what it asks for, what
// it means for the applications, whether it carries a company-wide notice. Most emails
// need none of that — a thank-you, a reminder, a document with no news. One Haiku call
// answers three yes/no questions first, and only a "yes" pays for the Sonnet step behind
// it. It is told to answer yes whenever unsure, so a missed decision costs a cheap call,
// never a missed offer.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_FAST_MODEL, isAiConfigured } from '@/lib/ai/config';
import { newestMessage } from './text';
import type { InboxMessage } from './inbox';

export type EmailScreen = {
  /** An offer, CAS, rejection, "application received", incomplete application, or change of agent. */
  applicationNews: boolean;
  /** News true for other students too: a course closed / reopened / not KCO-approved, a new rule. */
  generalNotice: boolean;
  /** Asks the agency or the student to send or answer something. */
  asksForSomething: boolean;
};

/** When the screen cannot run, everything goes through — the screen only ever saves money. */
export const PASS_ALL: EmailScreen = { applicationNews: true, generalNotice: true, asksForSomething: true };

const SYSTEM = `You take a quick first look at an email sent to a Kuwaiti study-abroad agency by a university, pathway provider (INTO, Study Group, Kaplan, Navitas…), agent (Merit…), the Kuwait Cultural Office or a family. Answer three yes/no questions about the NEWEST message (and the names of its attachments). Call record_screen once.

applicationNews: does it tell of a decision or change for an application — an offer (conditional or unconditional, including an attached offer letter), a CAS or I-20, a rejection or course closed, "application received / under review", an incomplete application held up for documents, or another agent applying for the student (change of agent)?
generalNotice: does it state something true for OTHER students as well — a course or university closed, paused, reopened, full, or not approved by the KCO; a new requirement or deadline for everyone?
asksForSomething: does it ask the agency or the student to send a document, answer a question, confirm something, or do something?

When unsure, answer true. A wrong "true" costs little; a wrong "false" means something is missed.`;

const TOOL: Anthropic.Tool = {
  name: 'record_screen',
  description: 'The three answers.',
  input_schema: {
    type: 'object',
    properties: {
      applicationNews: { type: 'boolean' },
      generalNotice: { type: 'boolean' },
      asksForSomething: { type: 'boolean' },
    },
    required: ['applicationNews', 'generalNotice', 'asksForSomething'],
  },
};

export async function screenEmail(message: InboxMessage): Promise<EmailScreen> {
  if (!isAiConfigured()) return PASS_ALL;
  try {
    const res = await getAnthropicClient('email-screen').messages.create({
      model: AI_FAST_MODEL,
      max_tokens: 200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'record_screen' },
      messages: [
        {
          role: 'user',
          content: [
            `From: ${message.fromName ? `${message.fromName} <${message.from}>` : message.from}`,
            `Subject: ${message.subject}`,
            `Attachments: ${message.attachments.map((a) => a.filename).join(', ') || 'none'}`,
            '',
            newestMessage(message.text).slice(0, 4000) || '(no text)',
          ].join('\n'),
        },
      ],
    });
    const use = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    const i = (use?.input ?? {}) as Partial<EmailScreen>;
    return {
      applicationNews: i.applicationNews !== false,
      generalNotice: i.generalNotice !== false,
      asksForSomething: i.asksForSomething !== false,
    };
  } catch (e) {
    console.error('[email-screen] failed, letting everything through:', e);
    return PASS_ALL;
  }
}
