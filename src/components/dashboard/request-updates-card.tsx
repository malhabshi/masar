'use client';

// What happened to the requests I submitted.
//
// Completing or denying a request already raised a notification addressed to whoever
// submitted it — but the dashboard's Updates list only renders category 'update' written
// by an admin or department user, and these are category 'system' authored by 'system'.
// So they were downloaded and then filtered out: 2,443 of them across the team, none
// ever shown. This card renders exactly those, from data the dashboard already holds.

import { useMemo, useState } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, orderBy, limit } from 'firebase/firestore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Clock, Loader2, Inbox } from 'lucide-react';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import { markRequestUpdatesRead } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Task } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import Link from 'next/link';

/** Only the last 60 days: older outcomes are history, not news. */
const RECENT_DAYS = 60;
const MAX_SHOWN = 15;
/** Outcomes to pull. Asked for directly, so a small number is plenty. */
const FETCH_LIMIT = 40;

const LOOK = {
  completed:     { icon: CheckCircle2, label: 'Completed', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  denied:        { icon: XCircle,      label: 'Denied',    cls: 'bg-red-100 text-red-800 border-red-300' },
  'in-progress': { icon: Clock,        label: 'In Progress', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
} as const;

export function RequestUpdatesCard({ currentUser }: { currentUser: AppUser }) {
  const { toast } = useToast();
  const [clearing, setClearing] = useState(false);

  // Its own small query rather than the dashboard's. The dashboards used to download
  // the entire tasks collection — 26,806 documents, 13.5 MB — to render two short
  // lists. This asks for outcome notifications addressed to this user and nothing else.
  //
  // Filtering on category in the query matters: outcomes are heavily outnumbered by
  // ordinary request notifications, so pulling the newest N of everything and sifting
  // client-side missed them entirely — for one admin the first outcome sat at position
  // 72. Needs the recipientIds + category + createdAt index.
  const constraints = useMemoFirebase(
    () => (currentUser?.id
      ? [
          where('recipientIds', 'array-contains', currentUser.id),
          where('category', '==', 'system'),
          orderBy('createdAt', 'desc'),
          limit(FETCH_LIMIT),
        ]
      : []),
    [currentUser?.id],
  );
  const { data: tasksData } = useCollection<Task>(currentUser?.id ? 'tasks' : '', ...constraints);
  const tasks = tasksData || [];

  // Unread only. Marking one read takes it off the list for good — this is a list of
  // things still to look at, not a history, and the team is carrying a large backlog.
  const recent = useMemo(() => {
    const cutoff = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
    return (tasks || [])
      .filter(t => {
        if (t.category !== 'system') return false;
        if (t.status !== 'new') return false; // already read
        const targets = t.recipientIds || (t.recipientId ? [t.recipientId] : []);
        if (!targets.includes(currentUser.id)) return false;
        // Older notifications predate the structured fields, so fall back to the text.
        if (!t.newStatus && !/status updated to/i.test(t.content || '')) return false;
        return Date.parse(t.createdAt) >= cutoff;
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [tasks, currentUser.id]);

  const updates = recent.slice(0, MAX_SHOWN);
  const unread = recent; // everything here is unread by definition

  const clear = async () => {
    setClearing(true);
    const res = await markRequestUpdatesRead(unread.map(u => u.id), currentUser.id);
    if (!res.success) toast({ variant: 'destructive', title: 'Could not mark as read', description: res.message });
    setClearing(false);
  };

  if (recent.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Inbox className="h-5 w-5 text-primary" />
          Updates on my requests
          {unread.length > 0 && (
            <Badge className="bg-primary text-primary-foreground">{unread.length} new</Badge>
          )}
        </CardTitle>
        {unread.length > 0 && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clear} disabled={clearing}>
            {clearing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Mark as read'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {updates.map(u => {
          const status = (u.newStatus ?? (/denied/i.test(u.content) ? 'denied' : /completed/i.test(u.content) ? 'completed' : 'in-progress')) as keyof typeof LOOK;
          const look = LOOK[status] ?? LOOK['in-progress'];
          const Icon = look.icon;
          const isNew = u.status === 'new';

          return (
            <div
              key={u.id}
              className={cn(
                'rounded-lg border p-3 transition-colors',
                'border-primary/40 bg-primary/5',
              )}
            >
              <div className="flex items-start gap-2.5">
                <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', status === 'denied' ? 'text-red-600' : status === 'completed' ? 'text-emerald-600' : 'text-amber-600')} />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={cn('text-[10px] font-bold', look.cls)}>{look.label}</Badge>
                    {isNew && <span className="text-[10px] font-bold uppercase tracking-wide text-primary">New</span>}
                    <span className="text-[11px] text-muted-foreground">{formatRelativeTime(u.createdAt)}</span>
                  </div>

                  <p className="text-sm font-bold">{u.taskType || 'Request'}</p>

                  {u.studentName && (
                    u.studentId ? (
                      <Link href={`/student/${u.studentId}`} className="block text-xs text-primary underline underline-offset-2">
                        {u.studentName}
                      </Link>
                    ) : <p className="text-xs text-muted-foreground">{u.studentName}</p>
                  )}

                  {u.denialReason && (
                    <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800">
                      <span className="font-bold">Reason:</span> {u.denialReason}
                    </p>
                  )}

                  {/* Older notifications carry only prose; show it when there is nothing better. */}
                  {!u.taskType && <p className="text-xs text-muted-foreground">{u.content}</p>}

                  {u.updatedByName && (
                    <p className="text-[10px] text-muted-foreground">by {u.updatedByName}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {recent.length > updates.length && (
          <p className="pt-1 text-center text-[11px] text-muted-foreground">
            Showing the {updates.length} most recent of {recent.length} updates from the last {RECENT_DAYS} days.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
