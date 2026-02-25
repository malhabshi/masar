
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

  const unassignedQuery = useMemo(() => [where('employeeId', '==', null)], []);

  const { data: unassignedStudents, isLoading: studentsAreLoading } =
    useCollection<Student>(
      currentUser ? 'students' : '',
      ...unassignedQuery
    );
  
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    currentUser ? 'users' : ''
  );

  const isLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  const employeeUsers = useMemo(() => {
    return (allUsers || []).filter(u => u.role === 'employee');
  }, [allUsers]);

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
            You do not have permission to view this page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const canAssign = currentUser.role === 'admin' || currentUser.role === 'department';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Unassigned Students</CardTitle>
            <CardDescription>
              Add new students here. They will appear in this list for an admin to assign.
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
                  <TableHead>Created By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedStudents && unassignedStudents.length > 0 ? (
                  unassignedStudents.map((student) => {
                    const creator = allUsers?.find(u => u.id === student.createdBy);
                    return (
                      <TableRow key={student.id}>
                        <TableCell>
                          <div className="font-medium">{student.name}</div>
                          <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                          <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                        </TableCell>
                        <TableCell>
                            {creator?.name || 'Unknown'}
                        </TableCell>
                        <TableCell className="text-right">
                          {canAssign && (
                            <AssignStudentDialog student={student} employees={employeeUsers} currentUser={currentUser} />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={3} className="h-24 text-center">
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
