'use client';

import { useMemo } from 'react';
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
  const { user: currentUser, isUserLoading } = useUser();

  const canManage = currentUser?.role === 'admin' || currentUser?.role === 'department';

  const { data: unassignedStudents, isLoading: studentsAreLoading } =
    useCollection<Student>(
      currentUser ? 'students' : '',
      where('employeeId', '==', null),
      ...(currentUser?.role === 'employee' ? [where('createdBy', '==', currentUser.id)] : [])
    );
  
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    canManage ? 'users' : ''
  );

  const isLoading = isUserLoading || studentsAreLoading || (canManage && usersAreLoading);

  const employeeUsers = useMemo(() => {
    if (!canManage) return [];
    return (allUsers || []).filter(u => u.role === 'employee');
  }, [allUsers, canManage]);

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
                      There are no unassigned students.
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
