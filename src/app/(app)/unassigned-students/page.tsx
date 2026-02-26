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
  
  // Guard the path: only query if user role is known
  const studentsPath = (isMounted && currentUser?.role) ? 'students' : '';
  const usersPath = (isMounted && currentUser) ? 'users' : '';

  const studentsConstraints = useMemoFirebase(() => {
    if (!studentsPath || !currentUser?.role) return [];
    
    if (isAdminOrDept) {
      // Admins see all unassigned students. We use orderBy to satisfy the "not unfiltered" guard.
      return [where('employeeId', '==', null), orderBy('createdAt', 'desc')];
    }
    
    if (isEmployee) {
      // Employees see students they created. Filtering for unassigned happens on client.
      // We don't use orderBy here to avoid composite index requirements.
      return [where('createdBy', '==', currentUser.id)];
    }
    
    return [where('id', '==', 'NONE')]; 
  }, [studentsPath, currentUser?.role, currentUser?.id, isAdminOrDept, isEmployee]);

  const { data: rawStudents, isLoading: studentsLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(usersPath);

  const unassignedStudents = useMemo(() => {
    if (!rawStudents) return [];
    // For employees, we filter for unassigned status here.
    if (currentUser?.role === 'employee') {
      return rawStudents.filter(s => s.employeeId === null);
    }
    return rawStudents;
  }, [rawStudents, currentUser?.role]);

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
