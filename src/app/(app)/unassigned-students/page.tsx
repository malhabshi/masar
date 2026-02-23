'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { StudentTable } from '@/components/dashboard/student-table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useUsers } from '@/contexts/users-provider';

export default function UnassignedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { usersLoading } = useUsers();

  // Define the query to fetch students where employeeId is null
  const unassignedQuery = useMemo(() => [where('employeeId', '==', null)], []);

  const { data: unassignedStudents, isLoading: studentsAreLoading } =
    useCollection<Student>(
      // Only fetch if the user is an admin or department member
      currentUser && ['admin', 'department'].includes(currentUser.role)
        ? 'students'
        : '',
      ...unassignedQuery
    );

  const isLoading = isUserLoading || studentsAreLoading || usersLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!currentUser || !['admin', 'department'].includes(currentUser.role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            You do not have permission to view this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Unassigned Students</CardTitle>
          <CardDescription>
            A list of newly added students who need to be assigned to an
            employee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StudentTable
            students={unassignedStudents || []}
            currentUser={currentUser}
            showEmployee={false} // Employee column is not needed here
            emptyStateMessage="There are no unassigned students."
          />
        </CardContent>
      </Card>
    </div>
  );
}
