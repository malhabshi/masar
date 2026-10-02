'use client';

// Changes on the watched official sites — the Cultural Offices in London and Washington,
// and MOHE — found by src/lib/site-watch.ts.
//
// Shown only when there is something unread. A permanent "nothing new" card would sit
// on the dashboard every day and teach everyone to scroll past it — which is exactly the
// habit that would make them miss the day it matters.

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ExternalLink, FileText, Landmark, Loader2, Megaphone, Newspaper, Check } from 'lucide-react';
import { getSiteWatchAlerts, markSiteWatchAlertsRead } from '@/lib/actions';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import { useToast } from '@/hooks/use-toast';
import type { AppUser } from '@/hooks/use-user';

type Alert = Awaited<ReturnType<typeof getSiteWatchAlerts>>['alerts'][number];

/** The sites are checked once a day; refreshing the card every 10 minutes just picks that up promptly. */
const REFRESH_MS = 10 * 60 * 1000;

const KIND = {
  post: { icon: Megaphone, label: 'New announcement' },
  page_changed: { icon: Newspaper, label: 'Page updated' },
  page_new: { icon: FileText, label: 'New page' },
  file_changed: { icon: FileText, label: 'File replaced' },
} as const;

export function SiteWatchCard({ currentUser }: { currentUser: AppUser }) {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'adminplus';

  const load = useCallback(async () => {
    if (!isAdmin || !currentUser?.id) return;
    const res = await getSiteWatchAlerts(currentUser.id);
    if (res.success) {
      setAlerts(res.alerts);
      setLastCheckedAt(res.lastCheckedAt);
    }
  }, [isAdmin, currentUser?.id]);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const markRead = async (ids: string[], key: string) => {
    setBusy(key);
    const res = await markSiteWatchAlertsRead(ids, currentUser.id);
    setBusy(null);
    if (!res.success) {
      toast({ variant: 'destructive', title: 'Could not mark as read', description: res.message });
      return;
    }
    setAlerts(prev => prev.filter(a => !ids.includes(a.id)));
  };

  if (!isAdmin || alerts.length === 0) return null;

  return (
    <Card className="border-info-border">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div className="space-y-0.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Landmark className="h-5 w-5 text-info" />
            Official Updates
            <Badge className="bg-info text-info-foreground">{alerts.length} new</Badge>
          </CardTitle>
          {lastCheckedAt && (
            <p className="text-[11px] text-muted-foreground">
              Cultural Offices &amp; MOHE · checked {formatRelativeTime(lastCheckedAt)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => markRead(alerts.map(a => a.id), 'all')}
          disabled={busy !== null}
        >
          {busy === 'all' ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Mark all as read'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-2">
        {alerts.map(a => {
          const look = KIND[a.kind as keyof typeof KIND] ?? KIND.page_changed;
          const Icon = look.icon;
          const hasDiff = a.added.length > 0 || a.removed.length > 0;
          const open = expanded === a.id;
          return (
            <div key={a.id} className="rounded-lg border bg-card p-3">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[10px] font-semibold text-foreground/70">{a.siteName}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-info">{look.label}</span>
                    <span className="text-[10px] text-muted-foreground">{formatRelativeTime(a.createdAt)}</span>
                  </div>
                  {/* dir="auto" so an Arabic title reads right-to-left without flipping the card. */}
                  <p dir="auto" className="break-words text-sm font-semibold leading-snug">{a.title}</p>
                  <p dir="auto" className="break-words text-xs leading-relaxed text-muted-foreground">{a.summary}</p>

                  {hasDiff && (
                    <button
                      type="button"
                      className="text-[11px] font-semibold text-primary hover:underline"
                      onClick={() => setExpanded(open ? null : a.id)}
                    >
                      {open ? 'Hide what changed' : 'Show what changed'}
                    </button>
                  )}
                  {open && (
                    <div className="space-y-1 rounded-md border bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
                      {a.added.map((l, i) => (
                        <p key={`a${i}`} dir="auto" className="break-words text-success">+ {l}</p>
                      ))}
                      {a.addedCount > a.added.length && (
                        <p className="text-muted-foreground">+ {a.addedCount - a.added.length} more added</p>
                      )}
                      {a.removed.map((l, i) => (
                        <p key={`r${i}`} dir="auto" className="break-words text-danger line-through decoration-danger/40">− {l}</p>
                      ))}
                      {a.removedCount > a.removed.length && (
                        <p className="text-muted-foreground">− {a.removedCount - a.removed.length} more removed</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-end gap-1 pl-7">
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" asChild>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => markRead([a.id], a.id)}
                  disabled={busy !== null}
                >
                  {busy === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  Read
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
