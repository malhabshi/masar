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
import { Loader2, AlertTriangle } from 'lucide-react';
import { useState, useEffect } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

  const { data: myStudents, isLoading: studentsAreLoading, error: studentsError } = useCollection<Student>(
    (isMounted && currentUser?.civilId) ? 'students' : '',
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
  
  if (!currentUser.civilId) {
     return (
        <Card>
            <CardHeader>
                <CardTitle className="text-destructive">Configuration Error</CardTitle>
            </CardHeader>
            <CardContent>
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Your user profile is missing its Civil ID. You cannot view assigned students until an administrator corrects your profile.
                  </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
     )
  }
  
  if (studentsError) {
      return (
        <Card>
            <CardHeader>
                <CardTitle className="text-destructive">Permission Error</CardTitle>
            </CardHeader>
            <CardContent>
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Could not load your students due to a permission error. This may be because no students are assigned to you, or there's a problem with the security rules.
                  </AlertDescription>
                </Alert>
            </CardContent>
        </Card>
      )
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
