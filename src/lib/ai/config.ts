// Central configuration for the masar AI assistant.
// Nothing here throws at import time — every consumer checks isAiConfigured() first so
// the app keeps building and running normally before an API key is ever supplied.

export const AI_MODEL = 'claude-opus-5';

// Reading uploaded documents is a high-volume, narrow job — one passport, offer or IELTS
// result at a time, thousands of them — so it runs on a smaller model than the assistant.
export const AI_DOC_MODEL = 'claude-sonnet-5-5';

// Simple, high-volume jobs where a small model does as well: one-line email summaries,
// naming files, choosing a thread, and the cheap first look at every email that decides
// whether the Sonnet steps are needed at all. About a third of Sonnet's price.
export const AI_FAST_MODEL = 'claude-haiku-4-5-20251001';

// Per-turn output cap. Each loop iteration is short (a sentence + some tool calls),
// so this is generous headroom rather than a target.
export const AI_MAX_TOKENS = 16000;

// Hard ceiling on tool-use round trips in a single agent run. Prevents a runaway loop
// from burning tokens if the model keeps calling tools without concluding.
export const AI_MAX_TOOL_ITERATIONS = 12;

// Roles allowed to use the assistant at all. Kept narrow on purpose for the first
// rollout — widen once behaviour has been observed in production.
export const AI_ALLOWED_ROLES = ['admin'] as const;

export function getAnthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function isAiConfigured(): boolean {
  return getAnthropicApiKey() !== null;
}

export const AI_NOT_CONFIGURED_MESSAGE =
  'The AI assistant is not configured yet. Add an ANTHROPIC_API_KEY environment variable ' +
  '(apphosting.yaml for production, .env.local for local development) and redeploy.';
