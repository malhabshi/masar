// Universal action dispatcher for the MCP. Reuses ALL of src/lib/actions.ts (112 server
// actions) instead of re-implementing each as an MCP tool. The catalog (auto-generated
// from the real signatures) provides arg order + which param receives the caller's
// identity + whether the action is destructive. This is what lets the MCP "control
// everything" through two tools: list_capabilities (discovery) and run_action (execute).
import * as actions from '@/lib/actions';
import { ACTION_CATALOG, ACTION_MAP, type CatalogAction } from './action-catalog';

export type Actor = { id: string; name: string; civilId?: string; role?: string };

// Resolve an @sentinel used by extraInject to a concrete value from the caller identity.
function resolveInject(sentinel: string, actor: Actor): unknown {
  switch (sentinel) {
    case '@userId': return actor.id;
    case '@name': return actor.name;
    case '@civilId': return actor.civilId ?? null;
    case '@role': return actor.role ?? 'admin';
    default: return sentinel;
  }
}

// Human-readable one-line signature for discovery output.
function signature(a: CatalogAction): string {
  const parts = a.params.map((p) => {
    if (p.name === a.actorParam) return `${p.name}=<you>`;
    if (a.extraInject && p.name in a.extraInject) return `${p.name}=<auto>`;
    return p.optional ? `${p.name}?` : p.name;
  });
  return `${a.name}(${parts.join(', ')})`;
}

export function listCapabilities(domain?: string) {
  const groups: Record<string, Array<{ action: string; signature: string; destructive: boolean; excluded: boolean }>> = {};
  for (const a of ACTION_CATALOG) {
    if (domain && a.domain.toLowerCase() !== domain.toLowerCase()) continue;
    (groups[a.domain] ||= []).push({
      action: a.name,
      signature: signature(a),
      destructive: a.destructive,
      excluded: a.excluded,
    });
  }
  const domains = Object.keys(groups).sort();
  return {
    note: 'Call run_action with { action, args, confirm }. Params shown as <you> are filled with your identity automatically; <auto> is derived. Destructive actions require confirm:true.',
    totalActions: ACTION_CATALOG.length,
    domains,
    capabilities: groups,
  };
}

export type RunResult =
  | { ok: false; needsConfirm: true; action: string; message: string }
  | { ok: false; error: string }
  | { ok: true; action: string; result: unknown };

export async function runAction(
  input: { action: string; args?: Record<string, unknown>; confirm?: boolean },
  actor: Actor,
): Promise<RunResult> {
  const meta = ACTION_MAP[input.action];
  if (!meta) return { ok: false, error: `Unknown action "${input.action}". Call list_capabilities to see valid actions.` };
  if (meta.excluded) return { ok: false, error: `Action "${input.action}" is not available via run_action (needs in-app file upload).` };

  const args = input.args ?? {};

  if (meta.destructive && !input.confirm) {
    return {
      ok: false,
      needsConfirm: true,
      action: meta.name,
      message: `"${meta.name}" is a destructive/high-impact action (${signature(meta)}). Re-run with confirm:true to execute. Args received: ${JSON.stringify(args)}`,
    };
  }

  // Assemble positional args in the exact order actions.ts declares them.
  const positional: unknown[] = [];
  const missing: string[] = [];
  for (const p of meta.params) {
    const explicit = Object.prototype.hasOwnProperty.call(args, p.name);
    if (meta.extraInject && p.name in meta.extraInject && !explicit) {
      positional.push(resolveInject(meta.extraInject[p.name], actor));
      continue;
    }
    if (p.name === meta.actorParam && !explicit) {
      positional.push(actor.id);
      continue;
    }
    if (explicit) {
      positional.push(args[p.name]);
      continue;
    }
    if (p.optional) {
      positional.push(undefined);
      continue;
    }
    missing.push(p.name);
    positional.push(undefined);
  }
  if (missing.length) {
    return { ok: false, error: `Missing required arg(s) for "${meta.name}": ${missing.join(', ')}. Signature: ${signature(meta)}` };
  }

  // Trim trailing undefined so functions see their own defaults.
  while (positional.length && positional[positional.length - 1] === undefined) positional.pop();

  const fn = (actions as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[meta.name];
  if (typeof fn !== 'function') return { ok: false, error: `Action "${meta.name}" not found in actions module.` };

  try {
    const result = await fn(...positional);
    return { ok: true, action: meta.name, result: JSON.parse(JSON.stringify(result ?? null)) };
  } catch (e) {
    return { ok: false, error: `Action "${meta.name}" threw: ${e instanceof Error ? e.message : String(e)}` };
  }
}
