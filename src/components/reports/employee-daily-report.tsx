'use client';

// One day's work for each employee and department user, and the AI's assessment of it.
// Built from what the system recorded; kept per day, so reopening is instant.

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';
import type { DailyReport, EmployeeDay } from '@/lib/reports/employee-daily';

const RATING: Record<string, { label: string; className: string }> = {
  excellent: { label: 'Excellent', className: 'border-success-border bg-success-soft text-success' },
  good: { label: 'Good', className: 'border-info-border bg-info-soft text-info' },
  needs_attention: { label: 'Needs attention', className: 'border-warning-border bg-warning-soft text-warning' },
  inactive: { label: 'Inactive', className: 'text-muted-foreground' },
};

/** Today in Kuwait, as YYYY-MM-DD. */
function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuwait' }) : '—';

export function EmployeeDailyReport() {
  const [date, setDate] = useState(kuwaitToday());
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) throw new Error('You are signed out. Reload the page.');
        const res = await fetch(`/api/reports/employee-daily?date=${date}${refresh ? '&refresh=1' : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Could not load the report.');
        setReport(data as DailyReport);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setReport(null);
      } finally {
        setLoading(false);
      }
    },
    [date],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const people = report?.employees ?? [];
  const portfolioStaff = people.filter((p) => p.portfolio);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          What each person did on the day, from what the system recorded, and how they did. Built by
          itself every night at 22:00; open any past day.
        </p>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[190px] justify-start font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(new Date(`${date}T12:00:00`), 'EEE, LLL dd, y')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="single"
                selected={new Date(`${date}T12:00:00`)}
                onSelect={(d) => d && setDate(format(d, 'yyyy-MM-dd'))}
                disabled={(d) => format(d, 'yyyy-MM-dd') > kuwaitToday()}
                initialFocus
              />
            </PopoverContent>
          </Popover>
          <Button variant="outline" onClick={() => load(true)} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !report && (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Counting the day&apos;s work and writing the review — this takes about a minute the first time.
        </div>
      )}

      {report?.teamSummary && (
        <Card>
          <CardContent className="pt-4 text-sm leading-relaxed">
            <span className="font-semibold">The team today: </span>
            {report.teamSummary}
          </CardContent>
        </Card>
      )}

      {report && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Each person</CardTitle>
            <CardDescription>
              Built {new Date(report.generatedAt).toLocaleString('en-GB', { timeZone: 'Asia/Kuwait' })}. &quot;Working&quot; is
              their first and last recorded action; &quot;Online&quot; is time logged in with the site open (employees only).
              &quot;Waiting&quot; = messages addressed to them by name and not yet answered.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Name</th>
                  <th className="px-2 font-medium">How they did</th>
                  <th className="px-2 font-medium">Working (first – last action)</th>
                  <th className="px-2 text-right font-medium">Online h</th>
                  <th className="px-2 text-right font-medium">Students added</th>
                  <th className="px-2 text-right font-medium">Requests raised</th>
                  <th className="px-2 text-right font-medium">Requests done</th>
                  <th className="px-2 text-right font-medium">Chat sent</th>
                  <th className="px-2 text-right font-medium">Answered</th>
                  <th className="px-2 text-right font-medium">Waiting</th>
                  <th className="px-2 text-right font-medium">Docs</th>
                  <th className="px-2 text-right font-medium">Pipeline</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <Row key={p.userId} p={p} open={open === p.userId} onToggle={() => setOpen(open === p.userId ? null : p.userId)} />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {report && portfolioStaff.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Their students right now</CardTitle>
            <CardDescription>
              Open students per employee, with what needs attention. Late = past the lateness rule for its status;
              quiet = no activity for 20+ days.
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2 font-medium">Employee</th>
                  <th className="px-2 text-right font-medium">Open students</th>
                  <th className="px-2 text-right font-medium">Late applications</th>
                  <th className="px-2 text-right font-medium">Quiet students</th>
                  <th className="px-2 text-right font-medium">Open missing items</th>
                </tr>
              </thead>
              <tbody>
                {[...portfolioStaff]
                  .sort((a, z) => (z.portfolio!.lateApplications - a.portfolio!.lateApplications))
                  .map((p) => (
                    <tr key={p.userId} className="border-b last:border-0">
                      <td className="py-2 pr-2">{p.name}</td>
                      <td className="px-2 text-right tabular-nums">{p.portfolio!.openStudents}</td>
                      <td className={cn('px-2 text-right tabular-nums', p.portfolio!.lateApplications > 0 && 'font-semibold text-warning')}>
                        {p.portfolio!.lateApplications}
                      </td>
                      <td className={cn('px-2 text-right tabular-nums', p.portfolio!.stagnantStudents > 0 && 'text-warning')}>
                        {p.portfolio!.stagnantStudents}
                      </td>
                      <td className="px-2 text-right tabular-nums">{p.portfolio!.openMissingItems}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ p, open, onToggle }: { p: EmployeeDay; open: boolean; onToggle: () => void }) {
  const r = RATING[p.rating ?? ''] ?? null;
  const n = (v: number) => <span className={cn('tabular-nums', v === 0 && 'text-muted-foreground')}>{v}</span>;
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={onToggle}>
        <td className="py-2 pr-2">
          <span className="flex items-center gap-1.5 font-medium">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {p.name}
          </span>
          <span className="pl-5 text-[11px] text-muted-foreground">
            {p.role === 'department' ? `Department ${p.department ?? ''}` : 'Employee'}
          </span>
        </td>
        <td className="px-2">{r ? <Badge variant="outline" className={cn('font-normal', r.className)}>{r.label}</Badge> : '—'}</td>
        <td className="px-2 text-xs tabular-nums">
          {p.firstAction ? `${time(p.firstAction)} – ${time(p.lastAction)} · ${p.actions} actions` : <span className="text-muted-foreground">no actions</span>}
        </td>
        <td className="px-2 text-right">{p.hours === null ? <span className="text-muted-foreground">—</span> : n(p.hours)}</td>
        <td className="px-2 text-right">{n(p.studentsCreated)}</td>
        <td className="px-2 text-right">{n(p.requestsCreated)}</td>
        <td className="px-2 text-right">{n(p.requestsHandled)}</td>
        <td className="px-2 text-right">{n(p.chatMessages)}</td>
        <td className="px-2 text-right">{n(p.messagesAnsweredToday)}</td>
        <td className={cn('px-2 text-right', p.messagesWaiting > 0 && 'font-semibold text-warning')}>{p.messagesWaiting}</td>
        <td className="px-2 text-right">{n(p.documentsUploaded)}</td>
        <td className="px-2 text-right">{n(p.pipelineChanges)}</td>
      </tr>
      {open && (
        <tr className="border-b bg-muted/20">
          <td colSpan={12} className="space-y-2 px-5 py-3 text-sm">
            {p.assessment && <p>{p.assessment}</p>}
            {p.suggestion && (
              <p>
                <span className="font-semibold">For tomorrow: </span>
                {p.suggestion}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Logged in {time(p.firstSeen)} – {time(p.lastSeen)} · notes written {p.notesWritten} · task replies{' '}
              {p.taskReplies} · inactivity reports {p.inactivityReports}
              {p.avgReplyHours !== null && ` · average time to answer a message ${p.avgReplyHours}h`}
              {Object.keys(p.requestsByType).length > 0 &&
                ` · requests: ${Object.entries(p.requestsByType).map(([k, v]) => `${k} ×${v}`).join(', ')}`}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
