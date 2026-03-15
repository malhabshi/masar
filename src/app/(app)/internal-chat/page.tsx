'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, orderBy, query, collection } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, MessageSquare, User as UserIcon, Clock } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdminDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const isEmployee = currentUser?.role === 'employee';

  // Fetch students who have chat history, sorted by most recent message
  const studentsQuery = useMemoFirebase(() => {
    if (!isMounted || !currentUser) return null;
    
    // We order by lastChatMessageTimestamp to get the SMS-style ranking
    // Documents without this field (old students) are hidden until they receive a new message
    const baseQuery = collection(firestore, 'students');
    
    if (isEmployee && currentUser.civilId) {
      return query(
        baseQuery,
        where('employeeId', '==', currentUser.civilId),
        orderBy('lastChatMessageTimestamp', 'desc')
      );
    }
    
    return query(
      baseQuery,
      orderBy('lastChatMessageTimestamp', 'desc')
    );
  }, [isMounted, currentUser, isEmployee]);

  const { data: studentsWithChat, isLoading: studentsAreLoading } = useCollection<Student>(studentsQuery);

  const employeeCivilIds = useMemo(() => {
    return [...new Set((studentsWithChat || []).map(s => s.employeeId).filter((id): id is string => !!id))];
  }, [studentsWithChat]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  const displayedStudents = useMemo(() => {
    if (!studentsWithChat) return [];
    
    // Department filtering: Only show students with applications in the user's specific region
    if (currentUser?.role === 'department' && currentUser.department) {
      const dept = currentUser.department;
      return studentsWithChat.filter(student => {
        const appCountries = (student.applications || []).map(a => a.country);
        const isMatch = (dept === 'UK' && appCountries.includes('UK')) || 
                        (dept === 'USA' && appCountries.includes('USA')) || 
                        (dept === 'AU/NZ' && (appCountries.includes('Australia') || appCountries.includes('New Zealand')));
        
        // If a student has no applications yet but has a chat, we show them to all depts 
        // to ensure new leads aren't missed in the inbox.
        if (appCountries.length === 0) return true;
        
        return isMatch;
      });
    }

    return studentsWithChat;
  }, [studentsWithChat, currentUser]);
  
  const isLoading = isUserLoading || !isMounted || studentsAreLoading;

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  if (!currentUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You must be logged in to view your chat inbox.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between px-2">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <MessageSquare className="h-8 w-8 text-primary" />
            Chat Inbox
          </h1>
          <p className="text-muted-foreground mt-1">
            {isAdminDept 
              ? "Recent conversations between employees and management." 
              : "Updates from management regarding your students."}
          </p>
        </div>
      </div>

      <Card className="border-0 shadow-none bg-transparent">
        <CardContent className="p-0 space-y-3">
          {displayedStudents.length > 0 ? (
            displayedStudents.map((student) => {
              const employee = student.employeeId ? employeeMap.get(student.employeeId) : null;
              const unreadCount = isAdminDept ? (student.unreadUpdates || 0) : (student.employeeUnreadMessages || 0);
              
              return (
                <Link key={student.id} href={`/student/${student.id}`}>
                  <div className={cn(
                    "group flex items-center gap-4 p-4 rounded-xl border bg-card hover:bg-muted/50 transition-all cursor-pointer shadow-sm",
                    unreadCount > 0 && "border-primary/50 bg-primary/5 ring-1 ring-primary/20"
                  )}>
                    <div className="relative">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg border">
                        {student.name.charAt(0)}
                      </div>
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 h-5 w-5 bg-destructive text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-background animate-in zoom-in">
                          {unreadCount}
                        </span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="font-bold text-base truncate">{student.name}</h3>
                        <span className="text-[10px] font-medium text-muted-foreground whitespace-nowrap flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {isMounted && student.lastChatMessageTimestamp ? formatRelativeTime(student.lastChatMessageTimestamp) : '...'}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium uppercase tracking-tighter">
                        <UserIcon className="h-3 w-3" />
                        <span>Assigned: {employee?.name || 'Unassigned'}</span>
                      </div>

                      <p className={cn(
                        "text-sm line-clamp-1 italic",
                        unreadCount > 0 ? "text-foreground font-semibold" : "text-muted-foreground"
                      )}>
                        {student.lastChatMessageText || "Shared a file"}
                      </p>
                    </div>

                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <Badge variant="outline" className="text-[10px] font-bold uppercase bg-background">View Chat</Badge>
                    </div>
                  </div>
                </Link>
              );
            })
          ) : (
            <div className="flex flex-col items-center justify-center py-20 bg-card rounded-xl border border-dashed text-muted-foreground">
              <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
              <p className="text-sm font-medium">No recent conversations found.</p>
              <p className="text-xs">Active threads with messages will appear here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
