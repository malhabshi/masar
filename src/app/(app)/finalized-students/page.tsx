'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';

interface FinalizedStudent extends Student {
    finalChoiceUniversity: string;
}

export default function FinalizedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();

  const studentsQuery = useMemo(() => {
    const baseQuery = [where('finalChoiceUniversity', '>', '')];

    if (!currentUser) {
      // Not logged in, don't query
      return null;
    }

    if (currentUser.role === 'employee') {
      if (!currentUser.civilId) {
        // Employee data not fully loaded, don't query yet
        return null;
      }
      // Employee query
      return [...baseQuery, where('employeeId', '==', currentUser.civilId)];
    }

    // Admin/Department query
    return baseQuery;
  }, [currentUser]);

  const { data: finalizedStudents, isLoading: studentsAreLoading } = useCollection<Student>(
    // Only set the path if the query is ready to be executed
    studentsQuery ? 'students' : '',
    ...(studentsQuery || [])
  );

  const isLoading = isUserLoading || (!!currentUser && studentsAreLoading);
  
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

  // Add a specific check for employees without civilId, just in case.
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
