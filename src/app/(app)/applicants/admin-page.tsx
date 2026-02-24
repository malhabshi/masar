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
import { useState, useEffect } from 'react';

export function AdminApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(
    currentUser ? 'students' : ''
  );
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    currentUser ? 'users' : ''
  );

  const dataIsLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  if (!isMounted || dataIsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (!currentUser) {
    return <p>Loading user...</p>;
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
