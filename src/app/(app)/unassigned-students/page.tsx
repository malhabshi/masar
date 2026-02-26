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
import { where, orderBy } from 'firebase/firestore';
import type { Student, User } from '@/lib/types';
import { StudentTable } from '@/components/dashboard/student-table';

export default function UnassignedStudentsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdminOrDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const isEmployee = currentUser?.role === 'employee';
  
  // Guard the path strictly based on role-readiness
  const studentsPath = (isMounted && currentUser?.role) ? 'students' : '';
  const usersPath = (isMounted && currentUser) ? 'users' : '';

  const studentsConstraints = useMemoFirebase(() => {
    if (!studentsPath || !currentUser?.role) return [];
    
    if (isAdminOrDept) {
      return [where('employeeId', '==', null), orderBy('createdAt', 'desc')];
    }
    
    if (isEmployee) {
      // Employees query students they created to find the unassigned ones
      return [where('createdBy', '==', currentUser.id), orderBy('createdAt', 'desc')];
    }
    
    return [where('id', '==', 'NONE')]; // Safety fallback
  }, [studentsPath, currentUser?.role, currentUser?.id, isAdminOrDept, isEmployee]);

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

  // Debug logging for Admin investigation
  useEffect(() => {
    if (isMounted && !studentsLoading && currentUser) {
        console.log('📊 Unassigned students data loaded:', {
            role: currentUser.role,
            count: unassignedStudents.length,
            path: studentsPath
        });
    }
  }, [unassignedStudents, studentsLoading, isMounted, currentUser, studentsPath]);

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
