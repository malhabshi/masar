import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicApiKey, AI_NOT_CONFIGURED_MESSAGE } from './config';
import { recordUsage } from './usage';

export class AiNotConfiguredError extends Error {
  constructor() {
    super(AI_NOT_CONFIGURED_MESSAGE);
    this.name = 'AiNotConfiguredError';
  }
}

let cached: Anthropic | null = null;

/**
 * Lazily build the Anthropic client. Throws AiNotConfiguredError if no key is set.
 *
 * `feature` names what the call is for ("documents", "email-status"…). Every
 * messages.create through the returned client reports its tokens to usage.ts under that
 * name, which is how the cost meter knows where the money goes.
 */
export function getAnthropicClient(feature = 'other'): Anthropic {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new AiNotConfiguredError();
  if (!cached) cached = new Anthropic({ apiKey });
  const real = cached;
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop !== 'messages') return Reflect.get(target, prop, receiver);
      return new Proxy(target.messages, {
        get(messages, key, r) {
          if (key !== 'create') return Reflect.get(messages, key, r);
          return async (...args: Parameters<typeof messages.create>) => {
            const res = await (messages.create as (...a: unknown[]) => Promise<unknown>).apply(messages, args);
            const usage = (res as { usage?: Parameters<typeof recordUsage>[2] })?.usage;
            void recordUsage(feature, String((args[0] as { model?: string })?.model ?? ''), usage);
            return res;
          };
        },
      });
    },
  });
}
