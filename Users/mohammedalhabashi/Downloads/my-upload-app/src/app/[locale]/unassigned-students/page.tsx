
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student, User } from '@/lib/types';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useMemo, useState } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Users } from 'lucide-react';
import { TransferStudentDialog } from '@/components/student/transfer-student-dialog';
import { formatDistanceToNow } from 'date-fns';

export default function UnassignedStudentsPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const [isClient, setIsClient] = useState(false);
  useMemo(() => setIsClient(true), []);

  const unassignedQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'students'), where('employeeId', '==', null));
  }, [firestore]);

  const { data: students, isLoading: studentsLoading } = useCollection<Student>(unassignedQuery);

  const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);
  
  if (isUserLoading || usersLoading || studentsLoading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (user?.role !== 'admin' && user?.role !== 'department') {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>Permission Denied</CardTitle>
                  <CardDescription>You do not have permission to view this page.</CardDescription>
              </CardHeader>
          </Card>
      )
  }

  const sortedStudents = students?.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Unassigned Students</CardTitle>
        <CardDescription>Students who have been created but are not yet assigned to an employee.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedStudents.length > 0 ? (
                sortedStudents.map(student => {
                  const creator = users.find(u => u.id === student.createdBy);
                  return (
                    <TableRow key={student.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={student.avatarUrl} alt={student.name} />
                            <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="font-medium">{student.name}</div>
                            <div className="text-sm text-muted-foreground">{student.email} | {student.phone}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isClient ? formatDistanceToNow(new Date(student.createdAt), { addSuffix: true }) : '...'}
                      </TableCell>
                       <TableCell>
                        {creator ? (
                            <div className="flex items-center gap-2">
                                <Avatar className="h-6 w-6">
                                    <AvatarImage src={creator.avatarUrl} alt={creator.name} />
                                    <AvatarFallback>{creator.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="text-sm">{creator.name}</span>
                            </div>
                        ) : 'Unknown'}
                      </TableCell>
                      <TableCell className="text-right">
                        {user.role === 'admin' && (
                            <TransferStudentDialog student={student} employees={employees} currentUser={user} />
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No unassigned students.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
      {sortedStudents.length > 0 && (
          <CardFooter>
              <div className="text-xs text-muted-foreground">
                  Showing <strong>{sortedStudents.length}</strong> unassigned students.
              </div>
          </CardFooter>
      )}
    </Card>
  );
}
