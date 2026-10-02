'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  MessageSquare,
  Plus,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

type ResponderSettings = {
  enabled: boolean;
  observeOnly: boolean;
  allowTaskCreation: boolean;
  mutedStudentIds: string[];
  aiConfigured: boolean;
};

const SUGGESTIONS = [
  'How many open students does each employee have, by pipeline colour?',
  'Which internal chat messages are still waiting for a reply?',
  'Which applications are late right now, and who owns them?',
  'How does a student move from JotForm to a final university choice here?',
];

type TeamNote = { id: string; topic: string; text: string; addedBy: string; addedAt: string };

const TOPIC_LABELS: Record<string, string> = {
  general: 'General',
  roles: 'Roles',
  students: 'Students',
  pipeline: 'Pipeline colours',
  applications: 'Applications',
  checklists: 'Checklists',
  documents_chat_notes: 'Documents, chat & notes',
  tasks: 'Tasks & requests',
  jotform: 'JotForm',
  universities: 'Universities',
  invoices_reports: 'Invoices & reports',
};

export default function AiAssistantPage() {
  const { user, isUserLoading } = useUser();

  const [wire, setWire] = useState<WireMessage[]>([]);
  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [input, setInput] = useState('');
  const [allowWrites, setAllowWrites] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [responder, setResponder] = useState<ResponderSettings | null>(null);
  const [savingResponder, setSavingResponder] = useState(false);

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
        const [statusRes, responderRes] = await Promise.all([
          authedFetch('/api/ai/chat'),
          authedFetch('/api/ai/chat-responder'),
        ]);
        const data = await statusRes.json();
        if (cancelled) return;
        if (!statusRes.ok) setStatusError(data.error ?? 'Could not load assistant status.');
        else setStatus(data as StatusPayload);
        if (responderRes.ok) setResponder((await responderRes.json()) as ResponderSettings);
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

  const updateResponder = useCallback(
    async (patch: Partial<ResponderSettings>) => {
      setSavingResponder(true);
      try {
        const res = await authedFetch('/api/ai/chat-responder', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (res.ok) setResponder(data as ResponderSettings);
        else setStatusError(data.error ?? 'Could not save responder settings.');
      } catch (e) {
        setStatusError(e instanceof Error ? e.message : String(e));
      } finally {
        setSavingResponder(false);
      }
    },
    [authedFetch],
  );

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
            The assistant can send email, upload documents, reply in the internal chat, save notes
            and run actions in this chat. It will ask before each one.
            {status?.email?.dryRun && ' Email is in dry-run mode, so messages are logged but not delivered.'}
            {status && !status.email.configured && ' Email is not configured yet, so sends will fail.'}
          </AlertDescription>
        </Alert>
      )}

      {responder && (
        <ResponderControls settings={responder} saving={savingResponder} onChange={updateResponder} />
      )}

      {user && <TeamNotes authedFetch={authedFetch} />}

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

/**
 * The team's own rules for the AI, in their words. Collapsed by default so it does not
 * push the conversation off the screen; the count in the header says whether anything
 * is in there.
 */
function TeamNotes({ authedFetch }: { authedFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<TeamNote[] | null>(null);
  const [topic, setTopic] = useState('general');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetch('/api/ai/knowledge')
      .then(async (r) => {
        const data = await r.json();
        if (r.ok) setNotes(data.notes);
        else setError(data.error ?? 'Could not load the notes.');
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [authedFetch]);

  const add = async () => {
    if (!text.trim()) return;
    setBusy('add');
    setError(null);
    try {
      const r = await authedFetch('/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, text }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Could not save the note.');
      setNotes(data.notes);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const r = await authedFetch(`/api/ai/knowledge?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Could not remove the note.');
      setNotes(data.notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center gap-2 text-base">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <BookOpen className="h-4 w-4" />
          How we work — notes for the AI
          {notes && <Badge variant="outline">{notes.length}</Badge>}
        </CardTitle>
        <CardDescription>
          The AI already knows how the system works. Add the rules only your team knows — what each
          pipeline colour means, who handles Ireland. These override everything else it reads.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          {notes && notes.length === 0 && (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
          {notes?.map((n) => (
            <div key={n.id} className="flex items-start gap-3 rounded-md border p-2.5">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p dir="auto" className="whitespace-pre-wrap break-words text-sm">{n.text}</p>
                <p className="text-[11px] text-muted-foreground">
                  {TOPIC_LABELS[n.topic] ?? n.topic} · {n.addedBy} · {new Date(n.addedAt).toLocaleDateString()}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={busy !== null}
                onClick={() => remove(n.id)}
                aria-label="Remove note"
              >
                {busy === n.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))}
          <div className="space-y-2 rounded-md border border-dashed p-2.5">
            <Textarea
              dir="auto"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Orange means the student has an offer but has not paid the deposit yet."
              rows={2}
              className="resize-none"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Select value={topic} onValueChange={setTopic}>
                <SelectTrigger className="h-8 w-[200px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TOPIC_LABELS).map(([k, label]) => (
                    <SelectItem key={k} value={k} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 gap-1" disabled={!text.trim() || busy !== null} onClick={add}>
                {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add note
              </Button>
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </CardContent>
      )}
    </Card>
  );
}

/**
 * Controls for the internal-chat responder. Separate from the chat above: this governs
 * whether the AI reads and speaks in staff chat on its own.
 */
function ResponderControls({
  settings,
  saving,
  onChange,
}: {
  settings: ResponderSettings;
  saving: boolean;
  onChange: (patch: Partial<ResponderSettings>) => void;
}) {
  const live = settings.enabled && !settings.observeOnly;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" />
              Internal chat responder
              {live ? (
                <Badge variant="destructive">Live — posting to staff chat</Badge>
              ) : settings.enabled ? (
                <Badge variant="secondary">Watching only</Badge>
              ) : (
                <Badge variant="outline">Off</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Reads every new internal chat message and replies when it can help. While it is on,
              staff can also pick &quot;Masar AI&quot; as a recipient to ask it directly.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <div className="flex items-center gap-2">
            <Switch
              id="responder-enabled"
              checked={settings.enabled}
              disabled={saving || !settings.aiConfigured}
              onCheckedChange={(v) => onChange({ enabled: v })}
            />
            <Label htmlFor="responder-enabled" className="cursor-pointer text-sm">
              Enabled
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="responder-observe"
              checked={settings.observeOnly}
              disabled={saving || !settings.enabled}
              onCheckedChange={(v) => onChange({ observeOnly: v })}
            />
            <Label htmlFor="responder-observe" className="cursor-pointer text-sm">
              Watch only (draft, don&apos;t post)
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="responder-tasks"
              checked={settings.allowTaskCreation}
              disabled={saving || !settings.enabled}
              onCheckedChange={(v) => onChange({ allowTaskCreation: v })}
            />
            <Label htmlFor="responder-tasks" className="cursor-pointer text-sm">
              Can create tasks
            </Label>
          </div>
        </div>

        {settings.enabled && settings.observeOnly && (
          <p className="text-xs text-muted-foreground">
            Nothing is posted to chat. Every reply it would have sent is written to the{' '}
            <span className="font-mono">ai_chat_log</span> collection so you can review its judgement
            before going live.
          </p>
        )}
        {live && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              The AI is posting into real staff chats as &quot;Masar AI&quot;
              {settings.allowTaskCreation && ' and can create tasks'}. Turn &quot;Watch only&quot; back
              on to stop it speaking.
            </AlertDescription>
          </Alert>
        )}
        {!settings.aiConfigured && (
          <p className="text-xs text-muted-foreground">
            Needs an ANTHROPIC_API_KEY before it can be enabled.
          </p>
        )}
      </CardContent>
    </Card>
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
