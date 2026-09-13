import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, AI_NOT_CONFIGURED_MESSAGE } from './config';

export class AiNotConfiguredError extends Error {
  constructor() {
    super(AI_NOT_CONFIGURED_MESSAGE);
    this.name = 'AiNotConfiguredError';
  }
}

let cached: Anthropic | null = null;

/** Lazily build the Anthropic client. Throws AiNotConfiguredError if no key is set. */
export function getAnthropicClient(): Anthropic {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new AiNotConfiguredError();
  if (!cached) cached = new Anthropic({ apiKey });
  return cached;
}
