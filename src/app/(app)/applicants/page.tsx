'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { StudentTable } from '@/components/dashboard/student-table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function ApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // --- Start of original page logic ---
  const { user: currentUser, isUserLoading } = useUser();
  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(
    currentUser ? 'students' : ''
  );
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    currentUser ? 'users' : ''
  );

  const isLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  // --- End of original page logic ---

  if (!isMounted) {
    return <div className="p-8 text-center">Loading applicants...</div>;
  }

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
          <CardDescription>You need to be logged in to view applicants.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Applicants</CardTitle>
            <CardDescription>
              A filterable list of all students in the system.
            </CardDescription>
          </div>
          {['admin', 'employee'].includes(currentUser.role) && <AddStudentDialog />}
        </CardHeader>
        <CardContent>
          <StudentTable
            students={allStudents || []}
            currentUser={currentUser}
            allUsers={allUsers || []}
          />
        </CardContent>
      </Card>
    </div>
  );
}
