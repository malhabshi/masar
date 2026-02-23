'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { StudentTable } from '@/components/dashboard/student-table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useUsers } from '@/contexts/users-provider';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';

export default function ApplicantsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { usersLoading } = useUsers();

  // Define constraints for the query based on the user's role
  const studentsQuery = useMemo(() => {
    if (!currentUser) return []; // No query if user isn't loaded
    if (currentUser.role === 'employee' && currentUser.civilId) {
      // Employees see only their assigned students
      return [where('employeeId', '==', currentUser.civilId)];
    }
    // Admins and Departments see all students, so no extra constraints
    return [];
  }, [currentUser]);

  // Use the useCollection hook with the defined constraints
  const { data: students, isLoading: studentsAreLoading } = useCollection<Student>(
    currentUser ? 'students' : '',
    ...studentsQuery
  );

  const isLoading = isUserLoading || usersLoading || studentsAreLoading;

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
                <CardDescription>You must be logged in to view this page.</CardDescription>
            </CardHeader>
        </Card>
    );
  }

  const description = currentUser.role === 'employee'
    ? 'A list of students currently assigned to you.'
    : 'A comprehensive list of all students in the system.';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Applicants</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {currentUser.role === 'employee' && (
             <Link href="/new-request">
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add New Student
                </Button>
            </Link>
          )}
        </CardHeader>
        <CardContent>
          <StudentTable
            students={students || []}
            currentUser={currentUser}
            showEmployee={currentUser.role !== 'employee'}
            showPipelineStatus
            showTerm
          />
        </CardContent>
      </Card>
    </div>
  );
}
