'use client';

import { useUser } from '@/hooks/use-user';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import type { Student, User } from '@/lib/types';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { TransferStudentDialog } from '@/components/student/transfer-student-dialog';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';

function UnassignedStudentTable({ 
    students: unassignedStudents, 
    allUsers,
    currentUser
}: { 
    students: Student[], 
    allUsers: User[],
    currentUser: User
}) {
    const employees = useMemo(() => allUsers.filter(u => u.role === 'employee'), [allUsers]);
    const canAssign = currentUser.role === 'admin';

    const emptyMessage = currentUser.role === 'employee' ? 'You have no submitted students pending assignment.' : 'No unassigned students.';

    return (
        <div className="rounded-lg border">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Student</TableHead>
                        <TableHead>Date Created</TableHead>
                        {canAssign && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                {unassignedStudents.length > 0 ? (
                    unassignedStudents.map((student) => (
                    <TableRow key={student.id}>
                        <TableCell>
                            <div className="flex items-center gap-3">
                                <Avatar>
                                    <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div>
                                    <a href={`/student/${student.id}`} className="font-medium hover:underline">{student.name}</a>
                                    <div className="text-sm text-muted-foreground">{student.email}</div>
                                </div>
                            </div>
                        </TableCell>
                        <TableCell>{new Date(student.createdAt).toLocaleDateString()}</TableCell>
                        
                        {canAssign && (
                            <TableCell className="text-right">
                                <TransferStudentDialog student={student} employees={employees} currentUser={currentUser} />
                            </TableCell>
                        )}
                    </TableRow>
                    ))
                ) : (
                    <TableRow>
                        <TableCell colSpan={canAssign ? 3 : 2} className="h-24 text-center">
                            {emptyMessage}
                        </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
        </div>
    );
}

export default function UnassignedStudentsPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  // Step 1: Query ALL unassigned students (simple query, no composite index needed)
  const studentsQuery = useMemo(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'students'), where('employeeId', '==', null));
  }, [firestore]);

  const { data: allUnassignedStudents, isLoading: areStudentsLoading } = useCollection<Student>(studentsQuery);
  
  // Step 2: Filter on the client side based on user role.
  const unassignedStudents = useMemo(() => {
    if (!allUnassignedStudents || !user) return [];
    
    if (user.role === 'employee') {
      // Employees only see unassigned students they created.
      return allUnassignedStudents.filter(student => student.createdBy === user.id);
    }
    
    // Admins and Departments see all unassigned students, sorted by most recent.
    return allUnassignedStudents.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allUnassignedStudents, user]);
  
  const isLoading = isUserLoading || areStudentsLoading || usersLoading;

  if (isLoading) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Unassigned Students</CardTitle>
                    <CardDescription>
                        Students that need to be assigned to an employee.
                    </CardDescription>
                </div>
                <Button asChild>
                <a href="/new-request?unassigned=true">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add a New Student
                </a>
                </Button>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
            </CardContent>
        </Card>
    );
  }

  if (!user) {
    return (
        <div className="flex h-full w-full items-center justify-center">
            <p className="text-muted-foreground">You must be logged in to view this page.</p>
        </div>
    )
  }

  const descriptionText = user.role === 'employee' 
      ? 'Students you have submitted that are pending assignment.'
      : 'Students that need to be assigned to an employee.';

  return (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
                <CardTitle>Unassigned Students</CardTitle>
                <CardDescription>{descriptionText}</CardDescription>
            </div>
            <Button asChild>
              <a href="/new-request?unassigned=true">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add a New Student
              </a>
            </Button>
        </CardHeader>
        <CardContent>
            <UnassignedStudentTable students={unassignedStudents || []} allUsers={users} currentUser={user} />
        </CardContent>
    </Card>
  );
}
