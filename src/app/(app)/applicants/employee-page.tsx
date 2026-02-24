'use client';

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
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function EmployeeApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // This is the key fix. The query is now constructed atomically.
  // The path and the 'where' clause are inseparable.
  const myStudentsQuery = useMemo(() => {
    if (isMounted && currentUser?.civilId) {
      // Debug log to confirm query is being created with the correct filter
      console.log('🔍 Querying students with:', {
        path: 'students',
        filter: `employeeId == ${currentUser.civilId}`,
      });
      return [where('employeeId', '==', currentUser.civilId)];
    }
    // If conditions aren't met, we don't query.
    return null;
  }, [isMounted, currentUser?.civilId]);

  const {
    data: myStudents,
    isLoading: studentsAreLoading,
    error: studentsError,
  } = useCollection<Student>(
    // The path is now simply dependent on whether the query was constructed.
    myStudentsQuery ? 'students' : '',
    // If the query is null, this will spread no arguments, but the path will also be empty.
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
              Your user profile is missing its Civil ID. You cannot view
              assigned students until an administrator corrects your profile.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
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
              Could not load your students. This is likely because your account
              does not have permission to read the 'students' collection with the
              query for your Civil ID ({currentUser.civilId}). Please check
              Firestore security rules.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
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
