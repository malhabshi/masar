'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  Send,
  Sparkles,
  Trash2,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser } from '@/hooks/use-user';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';

/**
 * Wire-format message (what the API needs), kept alongside a display-only rendering of
 * the same turn. The raw `content` blocks must be echoed back verbatim on the next
 * request — thinking blocks included — so the conversation stays valid.
 */
type WireMessage = { role: 'user' | 'assistant'; content: unknown };

type ToolCall = { name: string; input: unknown; isError: boolean; durationMs: number };

type DisplayTurn = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: ToolCall[];
  error?: string;
};

type StatusPayload = {
  aiConfigured: boolean;
  model: string;
  email: { configured: boolean; dryRun: boolean; provider: string; allowedDomains: string[] };
  setupHint?: string;
};

const SUGGESTIONS = [
  'Which applications are late right now, and who owns them?',
  'Summarise the last 30 days: new students, applications, and where they stand.',
  'Break down late applications by employee and tell me who needs help.',
  'How many applications are sitting in Missing Items, and for how long?',
];

export default function AiAssistantPage() {
  const { user, isUserLoading } = useUser();

  const [wire, setWire] = useState<WireMessage[]>([]);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [input, setInput] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  const authedFetch = useCallback(async (url: string, init?: RequestInit) => {
    const current = auth.currentUser;
    if (!current) throw new Error('You are signed out. Reload the page and sign in again.');
    const token = await current.getIdToken();
    return fetch(url, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }, []);

  // Probe configuration once the user is known, so the page can say what is missing.
  useEffect(() => {
    if (isUserLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/ai/chat');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setStatusError(data.error ?? 'Could not load assistant status.');
        else setStatus(data as StatusPayload);
      } catch (e) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isUserLoading, user, authedFetch]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, isSending]);

  const canSend = useMemo(
    () => input.trim().length > 0 && !isSending && status?.aiConfigured !== false,
    [input, isSending, status],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) return;

      const nextWire: WireMessage[] = [...wire, { role: 'user', content: trimmed }];
      setWire(nextWire);
      setTurns((t) => [...t, { id: `u-${Date.now()}`, role: 'user', text: trimmed }]);
      setInput('');
      setIsSending(true);

      try {
        const res = await authedFetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: nextWire, allowWrites }),
        });
        const data = await res.json();

        if (!res.ok) {
          setTurns((t) => [
            ...t,
            { id: `a-${Date.now()}`, role: 'assistant', text: '', error: data.error ?? `Request failed (${res.status}).` },
          ]);
          return;
        }

        // Keep the model's own turns so the next request replays them unchanged.
        if (Array.isArray(data.newMessages)) {
          setWire([...nextWire, ...(data.newMessages as WireMessage[])]);
        }

        setTurns((t) => [
          ...t,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: data.reply ?? '',
            toolCalls: data.toolCalls ?? [],
            error: data.error,
          },
        ]);
      } catch (e) {
        setTurns((t) => [
          ...t,
          { id: `a-${Date.now()}`, role: 'assistant', text: '', error: e instanceof Error ? e.message : String(e) },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [wire, allowWrites, isSending, authedFetch],
  );

  const reset = useCallback(() => {
    setWire([]);
    setTurns([]);
    setInput('');
  }, []);

  if (isUserLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Not available</AlertTitle>
        <AlertDescription>The AI assistant is currently limited to admin accounts.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Sparkles className="h-6 w-6 text-primary" />
            AI Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Ask about your students, applications and reports. It reads live data from masar.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="allow-writes" checked={allowWrites} onCheckedChange={setAllowWrites} />
            <Label htmlFor="allow-writes" className="cursor-pointer text-sm">
              Allow changes
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={reset} disabled={turns.length === 0 || isSending}>
            <Trash2 className="mr-2 h-4 w-4" />
            New chat
          </Button>
        </div>
      </div>

      {statusError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Could not reach the assistant</AlertTitle>
          <AlertDescription>{statusError}</AlertDescription>
        </Alert>
      )}

      {status && !status.aiConfigured && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Setup needed</AlertTitle>
          <AlertDescription>{status.setupHint}</AlertDescription>
        </Alert>
      )}

      {allowWrites && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Changes are enabled</AlertTitle>
          <AlertDescription>
            The assistant can send email, upload documents and run actions in this chat. It will ask
            before each one.
            {status?.email?.dryRun && ' Email is in dry-run mode, so messages are logged but not delivered.'}
            {status && !status.email.configured && ' Email is not configured yet, so sends will fail.'}
          </AlertDescription>
        </Alert>
      )}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {turns.length === 0 ? (
            <EmptyState onPick={send} disabled={isSending || status?.aiConfigured === false} />
          ) : (
            turns.map((turn) => <Turn key={turn.id} turn={turn} />)
          )}
          {isSending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Working through the data…
            </div>
          )}
        </CardContent>

        <div className="border-t p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) send(input);
                }
              }}
              placeholder="Ask a question, or describe the report you want…"
              rows={2}
              className="min-h-[56px] resize-none"
              disabled={isSending}
            />
            <Button onClick={() => send(input)} disabled={!canSend} size="lg">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Enter to send, Shift+Enter for a new line. Answers come from live data — spot-check
            anything you are about to act on.
          </p>
        </div>
      </Card>
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
      <Bot className="h-10 w-10 text-muted-foreground" />
      <div>
        <p className="font-medium">What would you like to know?</p>
        <p className="text-sm text-muted-foreground">Try one of these to start.</p>
      </div>
      <div className="grid w-full max-w-2xl gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Turn({ turn }: { turn: DisplayTurn }) {
  const isUser = turn.role === 'user';
  return (
    <div className={cn('flex gap-3', isUser && 'justify-end')}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={cn('max-w-[85%] space-y-2', isUser && 'order-first')}>
        {turn.toolCalls && turn.toolCalls.length > 0 && <ToolCallList calls={turn.toolCalls} />}
        {turn.text && (
          <div
            className={cn(
              'whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
              isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
            )}
          >
            {turn.text}
          </div>
        )}
        {turn.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">{turn.error}</AlertDescription>
          </Alert>
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
          <UserIcon className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

/** Shows what the assistant actually looked at — the audit trail for each answer. */
function ToolCallList({ calls }: { calls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const failed = calls.filter((c) => c.isError).length;

  return (
    <div className="rounded-md border bg-background/50 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted-foreground hover:text-foreground"
      >
        <Wrench className="h-3.5 w-3.5" />
        <span>
          Checked {calls.length} {calls.length === 1 ? 'source' : 'sources'}
        </span>
        {failed > 0 && (
          <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
            {failed} failed
          </Badge>
        )}
        <ChevronDown className={cn('ml-auto h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="space-y-1 border-t px-2.5 py-2">
          {calls.map((call, i) => (
            <div key={`${call.name}-${i}`} className="flex items-start gap-2">
              {call.isError ? (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              ) : (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />
              )}
              <div className="min-w-0 flex-1">
                <span className="font-mono">{call.name}</span>
                <span className="ml-2 text-muted-foreground">{call.durationMs}ms</span>
                {call.input != null && Object.keys(call.input as object).length > 0 && (
                  <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                    {JSON.stringify(call.input)}
                  </pre>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
