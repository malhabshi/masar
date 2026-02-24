'use client';

import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2 } from 'lucide-react';

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();

  // Only attempt to fetch data if the user is an admin or department member.
  const canFetch = currentUser && ['admin', 'department'].includes(currentUser.role);

  // Query for students with unread messages for admins/depts.
  const studentsQuery = useMemoFirebase(() => {
    if (!canFetch) return [];
    return [where('unreadUpdates', '>', 0)];
  }, [canFetch]);

  const { data: studentsWithUnread, isLoading: studentsAreLoading } = useCollection<Student>(
    canFetch ? 'students' : '', 
    ...studentsQuery
  );
  
  const isLoading = isUserLoading || studentsAreLoading;

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  if (!canFetch) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Internal Chats</CardTitle>
        <CardDescription>
          Students with unread messages or updates from employees.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StudentTable 
            students={studentsWithUnread || []} 
            currentUser={currentUser}
            showEmployee
            emptyStateMessage="No students have unread messages."
        />
      </CardContent>
    </Card>
  );
}
