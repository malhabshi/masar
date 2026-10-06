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
  autoApplicationStatus: boolean;
  followUps: boolean;
  reactToNotices: boolean;
  taskAddSchools: boolean;
  taskUpdateDrafts: boolean;
  scheduledIntake: boolean;
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

type CompanyProfile = {
  id: string;
  name: string;
  domains: string[];
  playbook: string;
  teamNotes: string;
  learnedFrom: { received: number; sent: number; at: string } | null;
};

type IntakeStatus = {
  configured: boolean;
  connection: { ok: boolean; error?: string };
  settings: IntakeSettings;
  pendingCount: number;
  queue: QueueItem[];
  requests?: EmailRequestRow[];
  companies?: CompanyProfile[];
  schedule?: {
    label: string;
    next: string;
    lastStart?: { slot: string; at: string; error: string | null } | null;
    lastRun?: { slot: string; at: string; processed: number; error: string | null } | null;
  };
};

/** "Last automatic check: Tue 15:02, 4 emails." — or why the latest one did not run. */
function lastAutoCheck(schedule: IntakeStatus['schedule']): string | null {
  const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const run = schedule?.lastRun;
  const start = schedule?.lastStart;
  if (start?.error && (!run || start.at > run.at)) return `The last automatic check could not start (${when(start.at)}): ${start.error}. It is tried again every five minutes.`;
  if (run?.error) return `The last automatic check stopped with an error (${when(run.at)}): ${run.error}. It is tried again every five minutes.`;
  if (run) return `Last automatic check: ${when(run.at)}, ${run.processed} email${run.processed === 1 ? '' : 's'}.`;
  return null;
}

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

      {status && (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              <strong>Application status from emails:</strong>{' '}
              {status.settings.autoApplicationStatus
                ? 'on — an offer sets Accepted, "application received" sets Submitted, incomplete sets Missing Items, unsuccessful or not KCO-approved sets Rejected. Accepted and Rejected are never changed by an email. A "conflicting application from another agent" email switches Change Agent on for that school, with the deadline noted.'
                : 'off — emails do not change application statuses.'}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                act(
                  { action: 'settings', autoApplicationStatus: !status.settings.autoApplicationStatus },
                  status.settings.autoApplicationStatus ? 'Status updates from email turned off' : 'Status updates from email turned on',
                )
              }
            >
              {status.settings.autoApplicationStatus ? 'Turn off' : 'Turn on'}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {status && (
        <Card>
          <CardContent className="space-y-3 pt-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Automatic inbox check:</strong>{' '}
                {status.settings.scheduledIntake
                  ? `on — ${status.schedule?.label ?? 'on schedule'}. Next: ${status.schedule?.next ?? '—'}. "Check inbox now" works any time.`
                  : 'off — the inbox is only checked when you press "Check inbox now".'}
                {status.settings.scheduledIntake && lastAutoCheck(status.schedule) && (
                  <span className="block text-muted-foreground">{lastAutoCheck(status.schedule)}</span>
                )}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act(
                    { action: 'settings', scheduledIntake: !status.settings.scheduledIntake },
                    status.settings.scheduledIntake ? 'Automatic checks turned off' : 'Automatic checks turned on',
                  )
                }
              >
                {status.settings.scheduledIntake ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Follow-ups:</strong>{' '}
                {status.settings.followUps
                  ? 'on — once a day, applications Submitted 5–60 days ago with no offer get an update request drafted in the conversation with the company (up to 15 a day).'
                  : 'off.'}
              </span>
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!status.settings.followUps}
                  onClick={() => act({ action: 'followUps' }, 'Follow-ups checked — see Drafts')}
                >
                  Check now
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    act({ action: 'settings', followUps: !status.settings.followUps }, status.settings.followUps ? 'Follow-ups turned off' : 'Follow-ups turned on')
                  }
                >
                  {status.settings.followUps ? 'Turn off' : 'Turn on'}
                </Button>
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Add-school requests:</strong>{' '}
                {status.settings.taskAddSchools
                  ? 'on — the schools chosen in an add-school request are added to the student as Pending.'
                  : 'off.'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act({ action: 'settings', taskAddSchools: !status.settings.taskAddSchools }, status.settings.taskAddSchools ? 'Turned off' : 'Turned on')
                }
              >
                {status.settings.taskAddSchools ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Update requests:</strong>{' '}
                {status.settings.taskUpdateDrafts
                  ? 'on — a "Request Update" task gets its email drafted in the conversation with the company, with any document it names attached.'
                  : 'off.'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act({ action: 'settings', taskUpdateDrafts: !status.settings.taskUpdateDrafts }, status.settings.taskUpdateDrafts ? 'Turned off' : 'Turned on')
                }
              >
                {status.settings.taskUpdateDrafts ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>Company notices:</strong>{' '}
                {status.settings.reactToNotices
                  ? 'on — news for everyone ("applications for this course are stopped", "we can submit again") is applied to every affected student: not-yet-submitted applications set to Rejected, the course closed in Approved Universities, each student told in the chat.'
                  : 'off.'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  act({ action: 'settings', reactToNotices: !status.settings.reactToNotices }, status.settings.reactToNotices ? 'Notices turned off' : 'Notices turned on')
                }
              >
                {status.settings.reactToNotices ? 'Turn off' : 'Turn on'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <RequestsCard
        requests={status?.requests ?? []}
        enabled={status?.settings.draftReplies !== false}
        onAct={act}
      />

      <CompaniesCard companies={status?.companies ?? []} onAct={act} />

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

/**
 * How each company writes to us — learned from its emails and our replies, with the
 * team's own notes on top. The AI reads these whenever it handles that company's mail.
 */
function CompaniesCard({
  companies,
  onAct,
}: {
  companies: CompanyProfile[];
  onAct: (payload: Record<string, unknown>, successMessage: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [domainEdits, setDomainEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDomains, setNewDomains] = useState('');

  const run = async (key: string, payload: Record<string, unknown>, message: string) => {
    setBusy(key);
    await onAct(payload, message);
    setBusy(null);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" />
          How each company works
        </CardTitle>
        <CardDescription>
          INTO, Study Group, Merit and the others each write differently. The AI learns each one&apos;s
          way from its emails and your replies, and follows it when it reads or answers their mail.
          Your notes on a company override what it learned. Add a new company any time.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Company name, e.g. Kaplan"
            className="h-8 w-48 text-sm"
          />
          <Input
            value={newDomains}
            onChange={(e) => setNewDomains(e.target.value)}
            placeholder="Email domain(s), e.g. kaplan.com, kaplanpathways.com"
            className="h-8 min-w-[220px] flex-1 text-sm"
          />
          <Button
            size="sm"
            className="h-8"
            disabled={busy !== null || !newName.trim() || !newDomains.trim()}
            onClick={async () => {
              await run('add', { action: 'saveCompany', companyName: newName, domains: newDomains }, `${newName.trim()} added — now learn it from the mailbox`);
              setNewName('');
              setNewDomains('');
            }}
          >
            {busy === 'add' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add company'}
          </Button>
        </div>
        {companies.map((c) => {
          const open = openId === c.id;
          const draft = notes[c.id] ?? c.teamNotes ?? '';
          return (
            <div key={c.id} className="rounded-lg border">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-3 text-left"
                onClick={() => setOpenId(open ? null : c.id)}
              >
                <span className="text-sm font-semibold">
                  {c.name} <span className="font-normal text-muted-foreground">· {c.domains[0]}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {c.teamNotes && <Badge variant="outline" className="text-[11px] font-normal">notes</Badge>}
                  {c.learnedFrom ? (
                    <Badge variant="secondary" className="text-[11px] font-normal">
                      learned from {c.learnedFrom.received} emails
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">not learned yet</Badge>
                  )}
                </span>
              </button>
              {open && (
                <div className="space-y-3 border-t p-3">
                  {c.playbook ? (
                    <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs leading-relaxed">
                      {c.playbook}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">No playbook yet — learn it from the mailbox.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold">Email domains</p>
                    <Input
                      value={domainEdits[c.id] ?? c.domains.join(', ')}
                      onChange={(e) => setDomainEdits((d) => ({ ...d, [c.id]: e.target.value }))}
                      className="h-8 min-w-[220px] flex-1 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      disabled={busy !== null || (domainEdits[c.id] ?? c.domains.join(', ')) === c.domains.join(', ')}
                      onClick={() =>
                        run(`dom-${c.id}`, { action: 'saveCompany', companyId: c.id, companyName: c.name, domains: domainEdits[c.id] }, `${c.name}: domains saved`)
                      }
                    >
                      Save domains
                    </Button>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold">Our notes on {c.name} (override the above)</p>
                    <textarea
                      dir="auto"
                      value={draft}
                      onChange={(e) => setNotes((n) => ({ ...n, [c.id]: e.target.value }))}
                      rows={3}
                      placeholder={`e.g. Always reply to ${c.name} in the same thread; they need the passport as PDF, not a photo.`}
                      className="w-full resize-y rounded-md border bg-background p-2 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mr-auto text-destructive hover:text-destructive"
                      disabled={busy !== null}
                      onClick={() => {
                        if (window.confirm(`Remove ${c.name}? Its playbook and notes are kept if you add it back.`)) {
                          void run(`rm-${c.id}`, { action: 'removeCompany', companyId: c.id }, `${c.name} removed`);
                        }
                      }}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => run(`learn-${c.id}`, { action: 'learnCompany', companyId: c.id }, `${c.name}: playbook learned`)}
                    >
                      {busy === `learn-${c.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
                      {c.learnedFrom ? 'Re-learn from mailbox' : 'Learn from mailbox'}
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy !== null || draft === (c.teamNotes ?? '')}
                      onClick={() => run(`notes-${c.id}`, { action: 'companyNotes', companyId: c.id, teamNotes: draft }, `${c.name}: notes saved`)}
                    >
                      Save notes
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
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
