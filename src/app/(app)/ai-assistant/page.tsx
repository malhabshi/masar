'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileSearch,
  Loader2,
  Wallet,
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

      {user && <SpendingPanel authedFetch={authedFetch} />}

      {user && <DocumentReader authedFetch={authedFetch} />}

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

const FEATURE_LABELS: Record<string, string> = {
  assistant: 'AI Assistant (this page)',
  chat: 'Internal chat replies',
  documents: 'Reading documents',
  passport: 'JotForm passport reader',
  requests: 'Requests (add schools / update emails)',
  'email-status': 'Email → application status',
  'email-requests': 'Email requests & reply drafts',
  'email-memory': 'Email memory',
  'email-naming': 'Naming emailed files',
  'email-chat-note': 'Email chat notes',
  'email-versions': 'Comparing reissued documents',
  notices: 'Company notices',
  'follow-ups': 'Follow-ups',
  'company-playbooks': 'Learning company playbooks',
  'daily-report': 'Daily employee report',
  other: 'Other',
};

type Spending = {
  status: {
    month: string;
    spent: number;
    budget: number;
    percent: number;
    paused: boolean;
    byFeature: Array<{ feature: string; cost: number; calls: number }>;
    byDay: Array<{ day: string; cost: number }>;
  };
  settings: { monthlyBudgetUsd: number; alertPercent: number; prices: Record<string, { input: number; output: number }> };
};

/**
 * What the AI costs this month, where it goes, and the budget. At the budget the
 * automatic jobs pause; anything started by hand keeps working.
 */
function SpendingPanel({ authedFetch }: { authedFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Spending | null>(null);
  const [budget, setBudget] = useState('');
  const [alertAt, setAlertAt] = useState('');
  const [prices, setPrices] = useState<Record<string, { input: string; output: string }>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const apply = (d: Spending) => {
    setData(d);
    setBudget(String(d.settings.monthlyBudgetUsd));
    setAlertAt(String(d.settings.alertPercent));
    setPrices(Object.fromEntries(Object.entries(d.settings.prices).map(([m, p]) => [m, { input: String(p.input), output: String(p.output) }])));
  };

  useEffect(() => {
    authedFetch('/api/ai/usage')
      .then(async (r) => {
        const d = await r.json();
        if (r.ok) apply(d);
        else setMessage(d.error ?? 'Could not load spending.');
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  }, [authedFetch]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await authedFetch('/api/ai/usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlyBudgetUsd: Number(budget),
          alertPercent: Number(alertAt),
          prices: Object.fromEntries(Object.entries(prices).map(([m, p]) => [m, { input: Number(p.input), output: Number(p.output) }])),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not save.');
      apply(d);
      setMessage('Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const st = data?.status;
  const usd = (v: number) => `$${v.toFixed(v < 10 ? 2 : 0)}`;

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center gap-2 text-base">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <Wallet className="h-4 w-4" />
          AI spending
          {st && (
            <Badge variant={st.paused ? 'destructive' : st.percent >= (data?.settings.alertPercent ?? 80) ? 'secondary' : 'outline'}>
              {usd(st.spent)}{st.budget ? ` of ${usd(st.budget)}` : ''} this month
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Estimated from the tokens each feature uses. At the budget, the automatic jobs pause until next month;
          anything you start by hand still works. Check the prices against your Anthropic bill.
        </CardDescription>
      </CardHeader>
      {open && st && (
        <CardContent className="space-y-4 pt-0">
          {st.paused && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>The budget is used up — automatic AI jobs are paused. Raise the budget to restart them.</AlertDescription>
            </Alert>
          )}
          {st.budget > 0 && (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full transition-all', st.paused ? 'bg-destructive' : st.percent >= (data!.settings.alertPercent ?? 80) ? 'bg-warning' : 'bg-primary')}
                  style={{ width: `${Math.min(100, st.percent)}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{st.percent}% of the {st.month} budget</p>
            </div>
          )}
          <div className="space-y-1">
            <p className="text-xs font-semibold">Where it goes</p>
            {st.byFeature.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet this month.</p>}
            {st.byFeature.map((f) => (
              <div key={f.feature} className="flex items-center justify-between gap-2 text-sm">
                <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                <span className="tabular-nums text-muted-foreground">
                  {usd(f.cost)} · {f.calls} calls
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <label className="space-y-1 text-xs">
              <span className="font-semibold">Monthly budget (USD, 0 = no limit)</span>
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" className="block h-8 w-28 rounded-md border bg-background px-2 text-sm" />
            </label>
            <label className="space-y-1 text-xs">
              <span className="font-semibold">Alert at (%)</span>
              <input value={alertAt} onChange={(e) => setAlertAt(e.target.value)} inputMode="numeric" className="block h-8 w-20 rounded-md border bg-background px-2 text-sm" />
            </label>
          </div>
          <div className="space-y-1">
            <p className="text-xs font-semibold">Prices (USD per million tokens)</p>
            {Object.entries(prices).map(([m, p]) => (
              <div key={m} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="w-48 font-mono">{m}</span>
                in
                <input value={p.input} onChange={(e) => setPrices((x) => ({ ...x, [m]: { ...x[m], input: e.target.value } }))} className="h-7 w-16 rounded-md border bg-background px-2" />
                out
                <input value={p.output} onChange={(e) => setPrices((x) => ({ ...x, [m]: { ...x[m], output: e.target.value } }))} className="h-7 w-16 rounded-md border bg-background px-2" />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            {message && <span className="text-xs text-muted-foreground">{message}</span>}
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

type DocProgress = {
  total: number;
  read: number;
  namedOnly: number;
  unreadable: number;
  errors: number;
  notYetRead: number;
  byType: Record<string, number>;
};

const DOC_TYPE_LABELS: Record<string, string> = {
  offer: 'Offers', passport: 'Passports', ielts: 'IELTS', toefl: 'TOEFL', transcript: 'Transcripts',
  school_certificate: 'Certificates', cas: 'CAS', i20: 'I-20', visa: 'Visas', receipt: 'Receipts',
  financial: 'Financial', mohe: 'MOHE / KCO', personal_statement: 'Statements', recommendation: 'References',
  jotform_summary: 'JotForm summaries', photo: 'Photos', civil_id: 'Civil IDs', medical: 'Medical', cv: 'CVs', other: 'Other',
};

/**
 * Reading students' documents: how far it has got, whether new uploads are read
 * automatically, whether passports are included, and a button to read the next batch.
 * Collapsed by default, like the notes.
 */
function DocumentReader({ authedFetch }: { authedFetch: (url: string, init?: RequestInit) => Promise<Response> }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<{ autoRead: boolean; readPassports: boolean } | null>(null);
  const [progress, setProgress] = useState<DocProgress | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadProgress = useCallback(async () => {
    const r = await authedFetch('/api/ai/documents?part=progress');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? 'Could not count the documents.');
    setProgress(data.progress);
  }, [authedFetch]);

  useEffect(() => {
    const fail = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
    authedFetch('/api/ai/documents')
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? 'Could not load document reading.');
        setSettings(data.settings);
      })
      .catch(fail);
    loadProgress().catch(fail);
  }, [authedFetch, loadProgress]);

  const save = async (patch: Partial<{ autoRead: boolean; readPassports: boolean }>) => {
    setBusy('settings');
    try {
      const r = await authedFetch('/api/ai/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Could not save.');
      setSettings(data.settings);
      setMessage('Saved.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const readBatch = async () => {
    setBusy('read');
    setMessage(null);
    try {
      const r = await authedFetch('/api/ai/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 50 }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? 'Reading failed.');
      setMessage(
        `Read ${data.read} of ${data.processed}` +
          (data.namedOnly ? `, ${data.namedOnly} identified by name only` : '') +
          (data.unreadable ? `, ${data.unreadable} unreadable` : '') +
          (data.errors ? `, ${data.errors} failed` : '') +
          `. ${data.pendingAfter} still to read.`,
      );
      await loadProgress();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const done = progress ? progress.total - progress.notYetRead : 0;
  const pct = progress && progress.total ? Math.round((done / progress.total) * 100) : 0;

  return (
    <Card>
      <CardHeader className="cursor-pointer pb-3" onClick={() => setOpen((v) => !v)}>
        <CardTitle className="flex items-center gap-2 text-base">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FileSearch className="h-4 w-4" />
          Student documents
          {progress && <Badge variant="outline">{pct}% read</Badge>}
        </CardTitle>
        <CardDescription>
          The AI reads each document once — offers, CAS, IELTS, transcripts, passports — and keeps
          what it says, so it can answer questions and spot mismatches.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 pt-0">
          {!progress && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Counting documents…
            </p>
          )}
          {!settings && !message && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading settings…
            </p>
          )}
          {progress && (
            <div className="space-y-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {done.toLocaleString()} of {progress.total.toLocaleString()} documents on open students
                {progress.notYetRead > 0 && ` · ${progress.notYetRead.toLocaleString()} not read yet`}
                {progress.errors > 0 && ` · ${progress.errors} failed (retried next time)`}
              </p>
              {Object.keys(progress.byType).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(progress.byType)
                    .sort((a, b) => b[1] - a[1])
                    .map(([t, n]) => (
                      <Badge key={t} variant="secondary" className="text-[11px] font-normal">
                        {DOC_TYPE_LABELS[t] ?? t} {n}
                      </Badge>
                    ))}
                </div>
              )}
            </div>
          )}
          {settings && (
            <div className="flex flex-wrap gap-x-8 gap-y-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="docs-auto"
                  checked={settings.autoRead}
                  disabled={busy !== null}
                  onCheckedChange={(v) => save({ autoRead: v })}
                />
                <Label htmlFor="docs-auto" className="cursor-pointer text-sm">
                  Read new uploads automatically
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="docs-passports"
                  checked={settings.readPassports}
                  disabled={busy !== null}
                  onCheckedChange={(v) => save({ readPassports: v })}
                />
                <Label htmlFor="docs-passports" className="cursor-pointer text-sm">
                  Include passports
                </Label>
              </div>
            </div>
          )}
          {settings && !settings.readPassports && (
            <p className="text-xs text-muted-foreground">
              Passports are recognised by name but their images are not sent to the AI.
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" className="h-8 gap-1" disabled={busy !== null || !progress?.notYetRead} onClick={readBatch}>
              {busy === 'read' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSearch className="h-3.5 w-3.5" />}
              {busy === 'read' ? 'Reading…' : 'Read the next 50 now'}
            </Button>
          </div>
          {message && <p className="text-xs text-muted-foreground">{message}</p>}
        </CardContent>
      )}
    </Card>
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
