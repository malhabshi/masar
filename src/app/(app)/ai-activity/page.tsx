'use client';

// Everything the AI changed, newest first, each with Undo. See src/lib/ai/action-log.ts.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { History, Loader2, RefreshCw, Undo2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';
import type { AiAction } from '@/lib/ai/action-log';

const SOURCES: Record<string, string> = {
  email: 'Email',
  notice: 'Company notice',
  change_agent: 'Change agent',
  task: 'Request',
  followup: 'Follow-up',
  document: 'Document',
  chat: 'Chat',
};

export default function AiActivityPage() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [actions, setActions] = useState<AiAction[] | null>(null);
  const [source, setSource] = useState<string>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = useCallback(async (init?: RequestInit, query = '') => {
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error('You are signed out. Reload the page.');
    return fetch(`/api/ai/actions${query}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await call(undefined, '?limit=300');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Could not load.');
      setActions(data.actions);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [call]);

  useEffect(() => {
    if (!isUserLoading && user?.role === 'admin') void load();
  }, [isUserLoading, user, load]);

  const undo = async (a: AiAction) => {
    if (!window.confirm(`Undo this?\n\n${a.summary}${a.studentName ? `\n(${a.studentName})` : ''}`)) return;
    setBusy(a.id);
    try {
      const res = await call({ method: 'POST', body: JSON.stringify({ id: a.id }) });
      const data = await res.json();
      toast({ variant: data.ok ? 'default' : 'destructive', title: data.ok ? 'Undone' : 'Not undone', description: data.message });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const shown = useMemo(() => (actions ?? []).filter((a) => source === 'all' || a.source === source), [actions, source]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of actions ?? []) c[a.source] = (c[a.source] ?? 0) + 1;
    return c;
  }, [actions]);

  if (isUserLoading) return <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />;
  if (user?.role !== 'admin') {
    return (
      <Alert variant="destructive" className="max-w-2xl">
        <AlertTitle>Not available</AlertTitle>
        <AlertDescription>The AI activity log is for admins.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <History className="h-6 w-6 text-primary" />
            AI Activity
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything the AI changed, newest first, with why. Undo puts a record back — unless someone has changed it
            again since, in which case it leaves their change alone.
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-1.5">
        {['all', ...Object.keys(SOURCES)].map((s) => (
          <Button key={s} size="sm" variant={source === s ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setSource(s)}>
            {s === 'all' ? `All (${actions?.length ?? 0})` : `${SOURCES[s]} (${counts[s] ?? 0})`}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Changes</CardTitle>
          <CardDescription>The last 300.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!actions && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
          {actions && shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>}
          {shown.map((a) => (
            <div key={a.id} className={cn('flex items-start gap-3 rounded-lg border p-3', a.undone && 'opacity-60')}>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Badge variant="outline" className="text-[11px] font-normal">{SOURCES[a.source] ?? a.source}</Badge>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(a.at).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait' })}
                  </span>
                  {a.studentId && (
                    <Link href={`/student/${a.studentId}`} className="text-xs font-semibold hover:underline">
                      {a.studentName}
                    </Link>
                  )}
                </div>
                <p dir="auto" className={cn('break-words text-sm', a.undone && 'line-through')}>{a.summary}</p>
                <p dir="auto" className="break-words text-xs text-muted-foreground">{a.reason}</p>
                {a.undone && (
                  <p className="text-[11px] text-muted-foreground">
                    Undone by {a.undone.byName}, {new Date(a.undone.at).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait' })}
                  </p>
                )}
              </div>
              {a.undo.type !== 'none' && !a.undone && (
                <Button size="sm" variant="outline" className="h-8 shrink-0 gap-1" disabled={busy !== null} onClick={() => undo(a)}>
                  {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                  Undo
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
