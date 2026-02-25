'use client';

import { useMemo, useState, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertTriangle } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

export default function FinalizedStudentsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // This logic now fetches data differently based on role to avoid composite query issues for employees.
  const studentsQuery = useMemo(() => {
    if (!isMounted || !currentUser) {
      return null;
    }
    
    // For Admins/Depts, query directly for finalized students. This is allowed by their broader security rules.
    if (currentUser.role === 'admin' || currentUser.role === 'department') {
      return [where('finalChoiceUniversity', '>', '')];
    }
    
    // For Employees, fetch ALL their students. The "finalized" filtering will happen on the client.
    // This avoids the composite query that was causing permission errors.
    if (currentUser.role === 'employee') {
      if (!currentUser.civilId) {
        return null;
      }
      return [where('employeeId', '==', currentUser.civilId)];
    }
    
    return null;
  }, [isMounted, currentUser]);

  // The hook now fetches either all finalized students (for admins) or all of an employee's students.
  const { data: fetchedStudents, isLoading: studentsAreLoading, error: studentsError } = useCollection<Student>(
    studentsQuery ? 'students' : '',
    ...(studentsQuery || [])
  );
  
  // This memo performs the client-side filtering for employees.
  const finalizedStudents = useMemo(() => {
    if (!fetchedStudents) return [];
    if (currentUser?.role === 'employee') {
      return fetchedStudents.filter(s => s.finalChoiceUniversity && s.finalChoiceUniversity.length > 0);
    }
    // Admins/Depts already get filtered data from the query, so no extra filtering is needed.
    return fetchedStudents;
  }, [fetchedStudents, currentUser?.role]);


  const isLoading = isUserLoading || !isMounted || (studentsQuery && studentsAreLoading);

  const pageDescription = currentUser?.role === 'employee' 
    ? "A list of your students who have made their final university choice."
    : "All students who have made their final university choice.";

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }
  
  if (!currentUser) {
       return (
        <Card>
            <CardHeader>
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>You must be logged in to view this page.</CardDescription>
            </CardHeader>
        </Card>
       )
  }

  if (currentUser.role === 'employee' && !currentUser.civilId) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Profile Incomplete</CardTitle>
                <CardDescription>Your user profile is missing a Civil ID. Please contact an administrator.</CardDescription>
            </CardHeader>
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
              Could not load finalized students. This is likely a Firestore security rule issue. Please contact support.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finalized Students</CardTitle>
        <CardDescription>
          {pageDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FinalizedStudentsTable
          students={(finalizedStudents as FinalizedStudent[]) || []}
          showEmployee={currentUser.role !== 'employee'}
        />
      </CardContent>
    </Card>
  );
}
