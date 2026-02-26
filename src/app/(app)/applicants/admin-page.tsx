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

  // SECURE: Use the path-guard pattern to ensure NO student queries run until role is confirmed.
  const studentsPath = (currentUser?.role === 'admin' || currentUser?.role === 'department') ? 'students' : '';
  const usersPath = currentUser ? 'users' : '';

  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(studentsPath);
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(usersPath);

  const dataIsLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  if (!isMounted || dataIsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (!currentUser || !studentsPath) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view the master applicants list.</CardDescription>
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
