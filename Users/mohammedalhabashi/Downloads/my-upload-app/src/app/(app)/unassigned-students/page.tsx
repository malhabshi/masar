'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student, User } from '@/lib/types';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { StudentTable } from '@/components/dashboard/student-table';

export default function UnassignedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const studentsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    // Query for students where employeeId is null or doesn't exist
    return query(collection(firestore, 'students'), where('employeeId', '==', null));
  }, [firestore]);

  const { data: unassignedStudents, isLoading: studentsAreLoading } = useCollection<Student>(studentsQuery);
  
  const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

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
        <CardTitle>Unassigned Students</CardTitle>
        <CardDescription>
          These students were created but have not been assigned to an employee yet.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StudentTable
            students={unassignedStudents || []}
            users={users}
            currentUser={currentUser}
            emptyStateMessage="There are no unassigned students."
            showApplicationCount
        />
      </CardContent>
    </Card>
  );
}
