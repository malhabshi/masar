'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, query, collection, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Task, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Bell, Info, AlertTriangle, CheckCircle2, MessageSquare, Loader2, Calendar, User as UserIcon } from 'lucide-react';
import { formatRelativeTime, sortByDate } from '@/lib/timestamp-utils';
import { cn } from '@/lib/utils';
import { useUserCacheById } from '@/hooks/use-user-cache';
import Link from 'next/link';

export default function NotificationsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const taskGroups = useMemo(() => {
    if (!currentUser) return [];
    const groups = [currentUser.id, 'all'];
    if (currentUser.role === 'admin') groups.push('admins');
    if (currentUser.role === 'department' && currentUser.department) {
        groups.push(`dept:${currentUser.department}`);
    }
    return groups;
  }, [currentUser]);

  const notificationsQuery = useMemoFirebase(() => {
    if (!currentUser) return null;
    
    // We fetch all tasks targeted at the user and filter categories on the client
    // to avoid complex composite index requirements for an MVP.
    return query(
      collection(firestore, 'tasks'),
      where('recipientIds', 'array-contains-any', taskGroups),
      orderBy('createdAt', 'desc')
    );
  }, [currentUser, taskGroups]);

  const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(notificationsQuery);

  const filteredNotifications = useMemo(() => {
    if (!tasks) return [];
    // Only show system alerts or manual updates (hide requests which are in Task Manager)
    return tasks.filter(t => t.category === 'system' || t.category === 'update');
  }, [tasks]);

  const allAuthorIds = useMemo(() => {
    return [...new Set(filteredNotifications.map(n => n.authorId))];
  }, [filteredNotifications]);

  const { userMap } = useUserCacheById(allAuthorIds);

  // Set "last viewed" marker when user leaves the page
  useEffect(() => {
    if (!isMounted || !currentUser) return;
    return () => {
      localStorage.setItem(`lastViewedNotifications_${currentUser.id}`, new Date().toISOString());
    };
  }, [isMounted, currentUser]);

  const getNotificationIcon = (content: string) => {
    const lower = content.toLowerCase();
    if (lower.includes('accepted') || lower.includes('completed')) return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (lower.includes('rejected') || lower.includes('denied')) return <AlertTriangle className="h-5 w-5 text-red-500" />;
    if (lower.includes('transferred') || lower.includes('assigned')) return <UserIcon className="h-5 w-5 text-blue-500" />;
    if (lower.includes('replied') || lower.includes('message')) return <MessageSquare className="h-5 w-5 text-purple-500" />;
    if (lower.includes('application') || lower.includes('university')) return <GraduationCap className="h-5 w-5 text-primary" />;
    return <Info className="h-5 w-5 text-muted-foreground" />;
  };

  if (!isMounted || isUserLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8 text-primary" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1">
            Stay updated with system changes and administrative alerts.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {tasksLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredNotifications.length > 0 ? (
            <div className="divide-y">
              {filteredNotifications.map((notif) => {
                const author = userMap.get(notif.authorId);
                return (
                  <div key={notif.id} className="p-4 hover:bg-muted/30 transition-colors flex gap-4 items-start">
                    <div className="mt-1 shrink-0">
                      {getNotificationIcon(notif.content)}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold">
                          {notif.category === 'system' ? 'System Alert' : author?.name || 'Admin Update'}
                        </span>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatRelativeTime(notif.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {notif.content}
                      </p>
                      {notif.studentId && (
                        <div className="pt-2">
                          <Link 
                            href={`/student/${notif.studentId}`} 
                            className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                          >
                            Go to Student Profile
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground text-center px-6">
              <Bell className="h-12 w-12 mb-4 opacity-20" />
              <h3 className="text-lg font-semibold">All clear!</h3>
              <p className="max-w-xs mx-auto">
                You don't have any new system notifications or updates at this time.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
