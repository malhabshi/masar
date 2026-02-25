'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';

interface FinalizedStudent extends Student {
    finalChoiceUniversity: string;
}

export default function FinalizedStudentsPage() {
  const { user: currentUser, isUserLoading } = useUser();

  const studentsQuery = useMemoFirebase(() => {
    if (!currentUser) return [];

    // Firestore does not support '!=' or 'is not null'. 
    // The common workaround is to check if the string is greater than an empty string.
    const baseQuery = [where('finalChoiceUniversity', '>', '')];
    
    if (currentUser.role === 'employee') {
      if (!currentUser.civilId) return []; // Employee must have civilId to query their students
      return [...baseQuery, where('employeeId', '==', currentUser.civilId)];
    }

    // For admin/department, just the base query is fine.
    return baseQuery;
  }, [currentUser?.role, currentUser?.civilId]);

  const { data: finalizedStudents, isLoading: studentsAreLoading } = useCollection<Student>(
    currentUser ? 'students' : '',
    ...studentsQuery
  );

  const isLoading = isUserLoading || studentsAreLoading;
  
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
