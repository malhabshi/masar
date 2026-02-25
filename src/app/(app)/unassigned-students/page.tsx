'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { AssignStudentDialog } from '@/components/student/assign-student-dialog';

export default function UnassignedStudentsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const studentsPath = currentUser ? 'students' : '';
  const studentsConstraints = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'employee') {
      return [
        where('employeeId', '==', null),
        where('createdBy', '==', currentUser.id),
      ];
    }
    // For admin/dept
    return [where('employeeId', '==', null)];
  }, [currentUser]);

  const { data: unassignedStudents, isLoading: studentsAreLoading, error } = useCollection<Student>(
    studentsPath,
    ...studentsConstraints
  );

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    canManage ? 'users' : ''
  );

  const employeeUsers = useMemo(() => {
    if (!canManage) return [];
    return (allUsers || []).filter(u => u.role === 'employee');
  }, [allUsers, canManage]);

  const isLoading = isUserLoading || !isMounted || studentsAreLoading || (canManage && usersAreLoading);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error) {
    console.error('Error fetching unassigned students:', error);
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Error Loading Students</CardTitle>
          <CardDescription>
            There was a problem fetching the list of unassigned students. This is likely due to a permissions issue or a missing Firestore index for the composite query.
          </CardDescription>
        </CardHeader>
      </Card>
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

  const descriptionText = "Add new students here. They will appear in the unassigned list for an admin to review and assign.";
  
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
          <div className="rounded-lg border">
              <Table>
              <TableHeader>
                  <TableRow>
                  <TableHead>Student</TableHead>
                  {canManage && <TableHead>Created By</TableHead>}
                  <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
              </TableHeader>
              <TableBody>
                  {unassignedStudents && unassignedStudents.length > 0 ? (
                  unassignedStudents.map((student) => (
                      <TableRow key={student.id}>
                          <TableCell>
                            <div className="font-medium">{student.name}</div>
                            <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                            <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                          </TableCell>
                          {canManage && (
                              <TableCell>
                                  {allUsers?.find(u => u.id === student.createdBy)?.name || 'Unknown'}
                              </TableCell>
                          )}
                          <TableCell className="text-right">
                              {canManage ? (
                                  <AssignStudentDialog student={student} employees={employeeUsers} currentUser={currentUser} />
                              ) : (
                                <span className="text-sm text-muted-foreground">Pending Assignment</span>
                              )}
                          </TableCell>
                      </TableRow>
                  ))
                  ) : (
                  <TableRow>
                      <TableCell colSpan={canManage ? 3 : 2} className="h-24 text-center">
                        {currentUser.role === 'employee' 
                            ? 'You have no students pending assignment.' 
                            : 'There are no unassigned students.'}
                      </TableCell>
                  </TableRow>
                  )}
              </TableBody>
              </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
