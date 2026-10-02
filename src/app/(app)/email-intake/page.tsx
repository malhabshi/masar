'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FlaskConical,
  Inbox,
  Loader2,
  Mail,
  MailCheck,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase, firestore } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { auth } from '@/firebase';
import type { Student } from '@/lib/types';
import Link from 'next/link';

type QueueAttachment = { filename: string; contentType: string; size: number; url: string | null };

type QueueItem = {
  id: string;
  reason: string;
  from: string;
  fromName: string;
  subject: string;
  receivedAt: string;
  bodyPreview: string;
  attachments: QueueAttachment[];
  candidates: Array<{ id: string; name: string }>;
};

type IntakeSettings = {
  restrictToStudentId: string | null;
  restrictToStudentName: string | null;
  aiRenameDocuments: boolean;
  postToChat: boolean;
  draftReplies: boolean;
};

type EmailRequestRow = {
  id: string;
  studentId: string;
  studentName: string;
  organisation: string | null;
  replyTo: string;
  subject: string;
  receivedAt: string;
  status: 'waiting' | 'drafted' | 'closed';
  items: Array<{ id: string; text: string; kind: 'document' | 'information' | 'action'; status: 'waiting' | 'ready' | 'drafted' | 'closed' }>;
  drafts: Array<{ at: string; items: string[]; attachments: string[] }>;
};

type IntakeStatus = {
  configured: boolean;
  connection: { ok: boolean; error?: string };
  settings: IntakeSettings;
  pendingCount: number;
  queue: QueueItem[];
  requests?: EmailRequestRow[];
};

export default function EmailIntakePage() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();

  const [status, setStatus] = useState<IntakeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authedFetch = useCallback(async (init?: RequestInit) => {
    const current = auth.currentUser;
    if (!current) throw new Error('You are signed out. Reload and sign in again.');
    const token = await current.getIdToken();
    return fetch('/api/email/intake', {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch();
      const data = await res.json();
      if (!res.ok) setError(data.error ?? 'Could not load intake status.');
      else {
        setStatus(data as IntakeStatus);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => {
    if (!isUserLoading && user?.role === 'admin') void load();
  }, [isUserLoading, user, load]);

  const runIntake = useCallback(async () => {
    setRunning(true);
    try {
      const res = await authedFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: 'destructive', title: 'Intake failed', description: data.error });
      } else {
        toast({
          title: 'Inbox checked',
          description:
            data.processed === 0
              ? 'No new emails.'
              : `${data.processed} email(s): ${data.filed} filed, ${data.notified} posted to chat, ` +
                `${data.queued} need review, ${data.skipped} skipped, ${data.failed} failed.` +
                (data.draftsCreated ? ` ${data.draftsCreated} reply draft(s) saved in Gmail.` : ''),
        });
      }
      await load();
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }, [authedFetch, load, toast]);

  const act = useCallback(
    async (payload: Record<string, unknown>, successMessage: string) => {
      const res = await authedFetch({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data.success === false) {
        toast({ variant: 'destructive', title: 'Failed', description: data.error ?? 'Unknown error' });
      } else {
        toast({ title: successMessage });
        await load();
      }
    },
    [authedFetch, load, toast],
  );

  if (isUserLoading || loading) {
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
        <AlertDescription>Email intake is limited to admin accounts.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Inbox className="h-6 w-6 text-primary" />
            Email Documents
          </h1>
          <p className="text-sm text-muted-foreground">
            Files sent by email are matched to a student by full name and attached to their profile.
          </p>
        </div>
        <Button onClick={runIntake} disabled={running || !status?.configured}>
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Check inbox now
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {status && !status.configured && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Not configured</AlertTitle>
          <AlertDescription>
            Set SMTP_USER and SMTP_PASSWORD to read the mailbox.
          </AlertDescription>
        </Alert>
      )}

      {status?.configured && !status.connection.ok && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Cannot reach the mailbox</AlertTitle>
          <AlertDescription>{status.connection.error}</AlertDescription>
        </Alert>
      )}

      {status?.configured && status.connection.ok && !status.settings.restrictToStudentId && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="text-sm">
            Mailbox connected. Emails whose text contains exactly one student&apos;s full name are
            filed automatically; anything else waits here for you.
          </AlertDescription>
        </Alert>
      )}

      {status?.settings.restrictToStudentId && (
        <Alert>
          <FlaskConical className="h-4 w-4" />
          <AlertTitle>Test mode</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>
              Only emails for <strong>{status.settings.restrictToStudentName}</strong> will be
              touched. Everything else in the mailbox is left completely alone — not filed, not
              queued, and still unread.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(
                  { action: 'settings', restrictToStudentId: null, restrictToStudentName: null },
                  'Test mode turned off — all students will be processed',
                )
              }
            >
              Turn off test mode
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <RequestsCard
        requests={status?.requests ?? []}
        enabled={status?.settings.draftReplies !== false}
        onAct={act}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Needs review{' '}
            {status && status.pendingCount > 0 && (
              <Badge variant="destructive" className="ml-1">{status.pendingCount}</Badge>
            )}
          </CardTitle>
          <CardDescription>
            Emails where the student could not be identified with certainty.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!status || status.queue.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing waiting. Everything received has been filed.
            </p>
          ) : (
            status.queue.map((item) => <ReviewRow key={item.id} item={item} onAct={act} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const ITEM_STYLE: Record<string, { label: string; className: string }> = {
  waiting: { label: 'Waiting for upload', className: 'border-warning-border bg-warning-soft text-warning' },
  ready: { label: 'Ready', className: 'border-info-border bg-info-soft text-info' },
  drafted: { label: 'Draft saved', className: 'border-success-border bg-success-soft text-success' },
  closed: { label: 'No reply needed', className: 'text-muted-foreground' },
};

/**
 * What emails asked for, and where each reply stands. A request waits until the file is
 * on the profile; then its reply is saved in Gmail Drafts for someone to check and send.
 */
function RequestsCard({
  requests,
  enabled,
  onAct,
}: {
  requests: EmailRequestRow[];
  enabled: boolean;
  onAct: (payload: Record<string, unknown>, successMessage: string) => Promise<void>;
}) {
  const [checking, setChecking] = useState(false);
  const waiting = requests.filter((r) => r.status === 'waiting').length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MailCheck className="h-4 w-4" />
              Requests &amp; reply drafts
              {waiting > 0 && <Badge variant="outline">{waiting} waiting</Badge>}
            </CardTitle>
            <CardDescription>
              What universities ask for by email goes onto the student as a Missing Item. When it is
              uploaded, a reply with the file attached is saved in Gmail Drafts — nothing is sent
              until you send it.
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={checking || !enabled}
              onClick={async () => {
                setChecking(true);
                await onAct({ action: 'drafts' }, 'Checked for uploaded documents');
                setChecking(false);
              }}
            >
              {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Check uploads now
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                onAct(
                  { action: 'settings', draftReplies: !enabled },
                  enabled ? 'Request tracking turned off' : 'Request tracking turned on',
                )
              }
            >
              {enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {requests.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            {enabled ? 'No requests yet. They appear here as emails are checked.' : 'Request tracking is off.'}
          </p>
        ) : (
          requests.map((r) => (
            <div key={r.id} className="space-y-1.5 rounded-lg border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold">
                  <Link href={`/student/${r.studentId}`} className="hover:underline">
                    {r.studentName}
                  </Link>
                  <span className="font-normal text-muted-foreground"> · {r.organisation ?? r.replyTo}</span>
                </p>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(r.receivedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground" title={r.subject}>
                {r.subject}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {r.items.map((it) => {
                  const look = it.kind === 'action' ? ITEM_STYLE.closed : ITEM_STYLE[it.status] ?? ITEM_STYLE.waiting;
                  return (
                    <Badge key={it.id} variant="outline" className={`text-[11px] font-normal ${look.className}`}>
                      {it.text} · {it.kind === 'action' ? 'to do' : look.label}
                    </Badge>
                  );
                })}
              </div>
              {r.drafts.length > 0 && (
                <p className="text-[11px] text-success">
                  {r.drafts.length} draft{r.drafts.length > 1 ? 's' : ''} saved in Gmail — last on{' '}
                  {new Date(r.drafts[r.drafts.length - 1].at).toLocaleString()}
                </p>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function ReviewRow({
  item,
  onAct,
}: {
  item: QueueItem;
  onAct: (payload: Record<string, unknown>, successMessage: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // Only query once there is something to search on, to avoid pulling the collection.
  const studentQuery = useMemoFirebase(() => {
    const term = search.trim();
    if (term.length < 3) return null;
    return query(
      collection(firestore, 'students'),
      where('name', '>=', term),
      where('name', '<=', term + ''),
    );
  }, [search]);
  const { data: searchResults } = useCollection<Student>(studentQuery);

  const file = async (studentId: string) => {
    setBusy(true);
    await onAct({ action: 'resolve', queueItemId: item.id, studentId }, 'Filed to student profile');
    setBusy(false);
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium">
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
            {item.subject || '(no subject)'}
          </p>
          <p className="text-xs text-muted-foreground">
            From {item.fromName ? `${item.fromName} <${item.from}>` : item.from} ·{' '}
            {new Date(item.receivedAt).toLocaleString()}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onAct({ action: 'dismiss', queueItemId: item.id }, 'Dismissed');
            setBusy(false);
          }}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          Dismiss
        </Button>
      </div>

      <p className="mt-2 text-xs text-amber-700 dark:text-amber-500">{item.reason}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {item.attachments.map((att) => (
          <a
            key={att.filename}
            href={att.url ?? '#'}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent"
          >
            <Download className="h-3 w-3" />
            {att.filename}
            <span className="text-muted-foreground">({Math.round(att.size / 1024)}KB)</span>
          </a>
        ))}
      </div>

      {item.bodyPreview && (
        <p className="mt-2 max-h-20 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs text-muted-foreground">
          {item.bodyPreview}
        </p>
      )}

      {item.candidates.length > 0 && (
        <div className="mt-3">
          <p className="mb-1 text-xs font-medium">Possible matches — pick the right one:</p>
          <div className="flex flex-wrap gap-2">
            {item.candidates.map((c) => (
              <Button key={c.id} size="sm" variant="outline" disabled={busy} onClick={() => file(c.id)}>
                {c.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <p className="mb-1 text-xs font-medium">Or search for the student:</p>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type at least 3 letters of the name…"
            className="h-9 pl-7 text-sm"
          />
        </div>
        {searchResults && searchResults.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {searchResults.slice(0, 8).map((s) => (
              <Button key={s.id} size="sm" variant="secondary" disabled={busy} onClick={() => file(s.id)}>
                {s.name}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
