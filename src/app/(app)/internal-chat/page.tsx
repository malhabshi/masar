'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student } from '@/lib/types';
import { firestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2 } from 'lucide-react';

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();

  // Query for students with unread messages for admins/depts.
  const studentsQuery = useMemoFirebase(() => {
    if (!currentUser || !['admin', 'department'].includes(currentUser.role)) return null;
    return query(collection(firestore, 'students'), where('unreadUpdates', '>', 0));
  }, [currentUser]);

  const { data: studentsWithUnread, isLoading: studentsAreLoading } = useCollection<Student>(studentsQuery);
  
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
            users={users} 
            currentUser={currentUser}
            showEmployee
            emptyStateMessage="No students have unread messages."
        />
      </CardContent>
    </Card>
  );
}
