'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Student, User } from '@/lib/types';
import { StudentTable } from '@/components/dashboard/student-table';

export default function UnassignedStudentsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const studentsPath = (isMounted && currentUser) ? 'students' : '';
  const usersPath = (isMounted && currentUser) ? 'users' : '';

  const studentsConstraints = useMemoFirebase(() => {
    if (!studentsPath || !currentUser) return [];
    if (currentUser.role === 'admin' || currentUser.role === 'department') {
      return [where('employeeId', '==', null)];
    }
    if (currentUser.role === 'employee') {
      // Employees query students they created
      return [where('createdBy', '==', currentUser.id)];
    }
    return [];
  }, [studentsPath, currentUser?.role, currentUser?.id]);

  const { data: rawStudents, isLoading: studentsLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(usersPath);

  const unassignedStudents = useMemo(() => {
    if (!rawStudents) return [];
    // For employees, we query all they created and filter for unassigned status here.
    if (currentUser?.role === 'employee') {
      return rawStudents.filter(s => s.employeeId === null);
    }
    return rawStudents;
  }, [rawStudents, currentUser?.role]);

  // Debug logging as requested
  useEffect(() => {
    if (isMounted && !studentsLoading && currentUser) {
        console.log('📊 Unassigned students data:', unassignedStudents);
    }
  }, [unassignedStudents, studentsLoading, isMounted, currentUser]);

  if (!isMounted || isUserLoading || studentsLoading || usersAreLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>
            You must be logged in to view this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const descriptionText = currentUser.role === 'employee'
    ? "Students you've added that are pending assignment by an administrator."
    : "Review new student profiles and assign them to an employee.";
  
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Unassigned Students</CardTitle>
            <CardDescription>
              {descriptionText}
            </CardDescription>
          </div>
          <AddStudentDialog />
        </CardHeader>
        <CardContent>
          <StudentTable
            students={unassignedStudents}
            currentUser={currentUser}
            allUsers={allUsers || []}
            emptyStateMessage="No unassigned students at this time."
          />
        </CardContent>
      </Card>
    </div>
  );
}
