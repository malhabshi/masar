
'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
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
import { AddStudentDialog } from '@/components/student/add-student-dialog';

export default function UnassignedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();

  const unassignedQuery = useMemo(() => [where('employeeId', '==', null)], []);

  const { data: unassignedStudents, isLoading: studentsAreLoading } =
    useCollection<Student>(
      currentUser ? 'students' : '',
      ...unassignedQuery
    );
  
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    currentUser ? 'users' : ''
  );

  const isLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
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
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Unassigned Students</CardTitle>
            <CardDescription>
              Add new students here. They will appear in this list for an admin to assign.
            </CardDescription>
          </div>
          <AddStudentDialog />
        </CardHeader>
        <CardContent>
          <StudentTable
            students={unassignedStudents || []}
            currentUser={currentUser}
            allUsers={allUsers || []}
            emptyStateMessage="There are no unassigned students."
          />
        </CardContent>
      </Card>
    </div>
  );
}
