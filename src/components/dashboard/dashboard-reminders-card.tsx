'use client';

import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Reminder } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { formatKuwaitTime } from '@/lib/timestamp-utils';
import { TimeLeft } from '@/components/reminders-time-left';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bell, Clock, MapPin, MessageSquare, Loader2, ArrowRight } from 'lucide-react';
import { isPast } from 'date-fns';
import { cn } from '@/lib/utils';
import Link from 'next/link';

function isReminderForUser(r: Reminder, user: AppUser): boolean {
  if (r.recipientType === 'all') return true;
  if (r.recipientType === 'admin' && (user.role === 'admin' || user.role === 'adminplus')) return true;
  if (r.recipientType === 'employee' && user.role === 'employee') return true;
  if (r.recipientType === 'department' && user.role === 'department') return true;
  if (r.recipientType === 'custom' && r.recipientUserIds?.includes(user.id)) return true;
  return false;
}

export function DashboardRemindersCard({ currentUser }: { currentUser: AppUser }) {
  const constraints = useMemoFirebase(() => [where('status', '==', 'active')], []);
  const { data: reminders, isLoading } = useCollection<Reminder>('student_reminders', ...constraints);

  const myReminders = (reminders || [])
    .filter(r => isReminderForUser(r, currentUser))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map(r => ({ ...r, _overdue: isPast(new Date(r.dueAt)) }));

  const overdueCount = myReminders.filter(r => r._overdue).length;

  if (!isLoading && myReminders.length === 0) return null;

  return (
    <Card className={cn(overdueCount > 0 && 'border-red-300')}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Bell className={cn('h-4 w-4', overdueCount > 0 ? 'text-red-500' : 'text-muted-foreground')} />
          <CardTitle className="text-base">Reminders</CardTitle>
          {overdueCount > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 leading-none">
              {overdueCount} overdue
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {myReminders.map(r => (
              <Link key={r.id} href={`/student/${r.studentId}`}>
                <div className={cn(
                  'flex items-start gap-3 rounded-md border p-3 transition-colors hover:bg-muted/60 cursor-pointer group',
                  r._overdue
                    ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                    : 'bg-muted/30 border-border'
                )}>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">{r.studentName}</p>
                    <p className="text-sm font-semibold leading-snug">{r.title}</p>

                    {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}

                    {r.location && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="h-3 w-3 shrink-0" />{r.location}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap pt-0.5">
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />{formatKuwaitTime(r.dueAt)}
                      </div>
                      <TimeLeft dueAt={r.dueAt} className="font-semibold" />
                      {r.notifyWhatsApp && (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <MessageSquare className="h-3 w-3" />WhatsApp
                        </span>
                      )}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
