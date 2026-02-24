'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { StudentTable } from '@/components/dashboard/student-table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AddStudentDialog } from '@/components/student/add-student-dialog';

export default function ApplicantsPage() {
  const { user: currentUser, isUserLoading } = useUser();

  // Fetch ALL students
  const { data: students, isLoading: studentsAreLoading } = useCollection<Student>(
    currentUser ? 'students' : ''
  );
  
  // Fetch ALL users for the employee filter dropdown
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    currentUser ? 'users' : ''
  );

  const isLoading = isUserLoading || studentsAreLoading || usersAreLoading;

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
    ? "A list of all students. Use the tabs to switch between your assigned students and all applicants."
    : 'A comprehensive list of all students in the system.';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Applicants</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <AddStudentDialog />
        </CardHeader>
        <CardContent>
          <StudentTable
            students={students || []}
            currentUser={currentUser}
            allUsers={allUsers || []}
            showEmployee={currentUser.role !== 'employee'}
            showPipelineStatus
            showTerm
            showIelts
            showAssignedFilter={currentUser.role === 'employee'}
          />
        </CardContent>
      </Card>
    </div>
  );
}
