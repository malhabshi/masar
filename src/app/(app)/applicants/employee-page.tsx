'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
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

export function EmployeeApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const myStudentsQuery = useMemoFirebase(() => {
    if (!currentUser?.civilId) return null;
    return [where('employeeId', '==', currentUser.civilId)];
  }, [currentUser?.civilId]);

  const { data: myStudents, isLoading: studentsAreLoading } = useCollection<Student>(
    myStudentsQuery ? 'students' : '',
    ...(myStudentsQuery || [])
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
            <CardTitle>My Applicants</CardTitle>
            <CardDescription>
              A filterable list of your assigned students.
            </CardDescription>
          </div>
          <AddStudentDialog />
        </CardHeader>
        <CardContent>
          <StudentTable
            students={myStudents || []}
            currentUser={currentUser}
            allUsers={allUsers || []}
          />
        </CardContent>
      </Card>
    </div>
  );
}
