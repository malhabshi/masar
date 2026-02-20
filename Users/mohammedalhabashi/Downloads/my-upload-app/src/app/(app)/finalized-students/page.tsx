'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student } from '@/lib/types';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';

interface FinalizedStudent extends Student {
    finalChoiceUniversity: string;
}

export default function FinalizedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(useMemoFirebase(() => !firestore ? null : collection(firestore, 'students'), [firestore]));

  const finalizedStudents = useMemo(() => {
    if (!allStudents) return [];
    return allStudents.filter(s => s.finalChoiceUniversity) as FinalizedStudent[];
  }, [allStudents]);

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
        <CardTitle>Finalized Students</CardTitle>
        <CardDescription>
          Students who have made their final university choice.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FinalizedStudentsTable
          students={finalizedStudents}
          users={users}
          showEmployee={currentUser.role !== 'employee'}
        />
      </CardContent>
    </Card>
  );
}
