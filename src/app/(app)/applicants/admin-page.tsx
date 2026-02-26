'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { orderBy } from 'firebase/firestore';
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
import { useState, useEffect, useMemo } from 'react';

export function AdminApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'department';
  
  // Guard the path: only query if user role is confirmed as Admin/Dept
  const studentsPath = (isMounted && isAdmin) ? 'students' : '';
  const usersPath = (isMounted && currentUser) ? 'users' : '';

  const studentsConstraints = useMemoFirebase(() => {
    if (!studentsPath) return [];
    return [orderBy('createdAt', 'desc')];
  }, [studentsPath]);

  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(usersPath);

  // Filter for ONLY assigned students (employeeId is not null)
  const assignedStudents = useMemo(() => {
    if (!allStudents) return [];
    return allStudents.filter(s => s.employeeId !== null);
  }, [allStudents]);

  const dataIsLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  if (!isMounted || dataIsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (!currentUser || !isAdmin) {
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
              A filterable list of all assigned students in the system.
            </CardDescription>
          </div>
          {['admin', 'employee'].includes(currentUser.role) && <AddStudentDialog source="applicants" />}
        </CardHeader>
        <CardContent>
          <StudentTable
            students={assignedStudents}
            currentUser={currentUser}
            allUsers={allUsers || []}
          />
        </CardContent>
      </Card>
    </div>
  );
}
