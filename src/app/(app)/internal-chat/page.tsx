'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { query, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2 } from 'lucide-react';
import { useUsers } from '@/contexts/users-provider';

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { usersLoading } = useUsers();

  // Query for students with unread messages for admins/depts.
  const studentsQuery = useMemo(() => {
    if (!currentUser || !['admin', 'department'].includes(currentUser.role)) return [];
    return [where('unreadUpdates', '>', 0)];
  }, [currentUser]);

  const { data: studentsWithUnread, isLoading: studentsAreLoading } = useCollection<Student>('students', ...studentsQuery);
  
  const isLoading = isUserLoading || usersLoading || studentsAreLoading;

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  if (!currentUser || !['admin', 'department'].includes(currentUser.role)) {
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
