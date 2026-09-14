// The agent loop: call the model, run any tools it asks for, feed the results back,
// repeat until it produces a final answer or hits the iteration ceiling.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient, AiNotConfiguredError } from './client';
import { AI_MODEL, AI_MAX_TOKENS, AI_MAX_TOOL_ITERATIONS } from './config';
import { buildSystemPrompt } from './system-prompt';
import {
  buildToolRegistry,
  executeTool,
  getToolDefinitions,
  type AiTool,
  type ToolContext,
  type ToolExecution,
} from './tools';
import type { Actor } from '@/lib/mcp/dispatch';

export type AgentRunInput = {
  /** Full conversation so far, oldest first. Must start with a user message. */
  messages: Anthropic.MessageParam[];
  actor: Actor;
  allowWrites: boolean;
  /** Replace the default tool surface. Used by the internal-chat responder. */
  toolset?: AiTool[];
  /** Replace the default system prompt. */
  system?: Anthropic.TextBlockParam[];
  /** Lower the tool-round ceiling for short-lived agents. */
  maxIterations?: number;
};

export type AgentRunResult = {
  ok: boolean;
  /** The assistant's final text reply. */
  reply: string;
  /** Assistant/user turns produced during this run, to append to the stored conversation. */
  newMessages: Anthropic.MessageParam[];
  /** Every tool the model ran this turn, in order — surfaced in the UI for transparency. */
  toolCalls: Array<{ name: string; input: unknown; isError: boolean; durationMs: number }>;
  iterations: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
  /** Set when the run ended abnormally (not configured, refused, capped, API error). */
  error?: string;
  stopReason?: string;
};

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Tool results are JSON-stringified for the model; oversized payloads are truncated. */
const MAX_TOOL_RESULT_CHARS = 60_000;

function serializeToolResult(result: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(result, null, 2);
  } catch {
    text = String(result);
  }
  if (text.length > MAX_TOOL_RESULT_CHARS) {
    return (
      text.slice(0, MAX_TOOL_RESULT_CHARS) +
      `\n\n[truncated — result was ${text.length} characters. Narrow the query (add a filter or a smaller limit) to see the rest.]`
    );
  }
  return text;
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const { actor, allowWrites } = input;
  const ctx: ToolContext = { actor, allowWrites };

  const newMessages: Anthropic.MessageParam[] = [];
  const toolCalls: AgentRunResult['toolCalls'] = [];
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  const base = (): AgentRunResult => ({
    ok: false,
    reply: '',
    newMessages,
    toolCalls,
    iterations: 0,
    usage,
  });

  let client: Anthropic;
  try {
    client = getAnthropicClient();
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return { ...base(), error: e.message };
    throw e;
  }

  const system = input.system ?? buildSystemPrompt(actor, allowWrites);
  const registry = input.toolset ? buildToolRegistry(input.toolset) : undefined;
  const tools = input.toolset
    ? input.toolset.filter((t) => allowWrites || !t.write).map((t) => t.definition)
    : getToolDefinitions(allowWrites);
  const maxIterations = input.maxIterations ?? AI_MAX_TOOL_ITERATIONS;
  const working: Anthropic.MessageParam[] = [...input.messages];

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: AI_MAX_TOKENS,
        system,
        tools,
        thinking: { type: 'adaptive' },
        messages: working,
      });
    } catch (e) {
      let message: string;
      if (e instanceof Anthropic.AuthenticationError) {
        message = 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.';
      } else if (e instanceof Anthropic.RateLimitError) {
        message = 'Rate limited by the Anthropic API. Wait a moment and try again.';
      } else if (e instanceof Anthropic.APIError) {
        message = `Anthropic API error ${e.status}: ${e.message}`;
      } else {
        message = e instanceof Error ? e.message : String(e);
      }
      return { ...base(), iterations: iteration - 1, error: message };
    }

    usage.inputTokens += response.usage.input_tokens ?? 0;
    usage.outputTokens += response.usage.output_tokens ?? 0;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;

    // A safety decline ends the run; there is nothing useful to loop on.
    if (response.stop_reason === 'refusal') {
      return {
        ...base(),
        iterations: iteration,
        stopReason: 'refusal',
        error: 'The model declined to answer this request.',
      };
    }

    // Echo the full content back (thinking blocks included) so the next turn stays valid.
    working.push({ role: 'assistant', content: response.content });
    newMessages.push({ role: 'assistant', content: response.content });

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    if (toolUses.length === 0) {
      return {
        ok: true,
        reply: extractText(response.content),
        newMessages,
        toolCalls,
        iterations: iteration,
        usage,
        stopReason: response.stop_reason ?? undefined,
      };
    }

    // Run the batch concurrently, then return every result in ONE user message —
    // splitting them across messages would train the model out of parallel calls.
    const executions: ToolExecution[] = await Promise.all(
      toolUses.map((use) =>
        executeTool(use.name, (use.input ?? {}) as Record<string, any>, ctx, registry),
      ),
    );

    const resultBlocks: Anthropic.ToolResultBlockParam[] = toolUses.map((use, i) => ({
      type: 'tool_result',
      tool_use_id: use.id,
      content: serializeToolResult(executions[i].result),
      ...(executions[i].isError ? { is_error: true } : {}),
    }));

    for (const exec of executions) {
      toolCalls.push({
        name: exec.name,
        input: exec.input,
        isError: exec.isError,
        durationMs: exec.durationMs,
      });
    }

    working.push({ role: 'user', content: resultBlocks });
    newMessages.push({ role: 'user', content: resultBlocks });
  }

  // Ceiling hit: hand back whatever text the model produced along the way.
  const lastText = [...newMessages]
    .reverse()
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .find((b): b is Anthropic.TextBlock => (b as Anthropic.ContentBlock).type === 'text');

  return {
    ok: false,
    reply: lastText?.text ?? '',
    newMessages,
    toolCalls,
    iterations: maxIterations,
    usage,
    error: `Stopped after ${maxIterations} tool rounds without reaching an answer. Try asking something narrower.`,
  };
}
