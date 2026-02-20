'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student } from '@/lib/types';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2 } from 'lucide-react';
import { TransferStudentDialog } from '@/components/student/transfer-student-dialog';

export default function UnassignedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const studentsQuery = useMemoFirebase(() => {
    if (!firestore || !currentUser || currentUser.role === 'employee') return null;
    return query(collection(firestore, 'students'), where('employeeId', '==', null));
  }, [firestore, currentUser]);

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
          These students have been created but are not yet assigned to an employee.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <StudentTable 
            students={unassignedStudents || []} 
            users={users} 
            currentUser={currentUser}
            emptyStateMessage="There are no unassigned students."
            showApplicationCount
            showCountries
        />
      </CardContent>
    </Card>
  );
}
