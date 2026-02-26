'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2, MessageSquare } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdminDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const isEmployee = currentUser?.role === 'employee';

  // Management sees students with unread employee messages
  // Employees see students with unread management updates
  const studentsQuery = useMemoFirebase(() => {
    if (!isMounted || !currentUser) return [];
    
    if (isAdminDept) {
      return [where('unreadUpdates', '>', 0)];
    }
    
    if (isEmployee && currentUser.civilId) {
      return [
        where('employeeId', '==', currentUser.civilId),
        where('employeeUnreadMessages', '>', 0)
      ];
    }
    
    return [where('id', '==', 'NONE')];
  }, [isMounted, currentUser, isAdminDept, isEmployee]);

  const { data: studentsWithUnread, isLoading: studentsAreLoading } = useCollection<Student>(
    (isMounted && currentUser) ? 'students' : '', 
    ...studentsQuery
  );

  const { data: allUsers } = useCollection<User>((isMounted && currentUser) ? 'users' : '');
  
  const isLoading = isUserLoading || !isMounted || studentsAreLoading;

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            Chat Inbox
          </CardTitle>
          <CardDescription>
            {isAdminDept 
              ? "Students with unread messages from employees waiting for review." 
              : "Your students with new updates or responses from management."}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <StudentTable 
            students={studentsWithUnread || []} 
            currentUser={currentUser}
            allUsers={allUsers || []}
            emptyStateMessage={isAdminDept ? "No students have unread messages for management." : "No unread updates for your students."}
        />
      </CardContent>
    </Card>
  );
}
