'use client';

import { useState, useMemo } from 'react';
import type { Student, User, StudentLogin } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { formatDate } from '@/lib/timestamp-utils';
import { deleteStudentLogin, resetStudentPassword } from '@/lib/actions';

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { PlusCircle, Trash2, KeyRound, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { AddStudentUserDialog } from './add-student-user-dialog';

interface StudentUsersCardProps {
  student: Student;
  currentUser: AppUser;
}

export function StudentUsersCard({ student, currentUser }: StudentUsersCardProps) {
  const { toast } = useToast();
  const [isMutating, setIsMutating] = useState<string | null>(null);

  const canManage = currentUser.role === 'admin' || currentUser.civilId === student.employeeId;

  const userIds = useMemo(() => student.studentLogins?.map(l => l.uid) || [], [student.studentLogins]);
  const { userMap } = useUserCacheById(userIds);

  const studentUsers: (StudentLogin & { user?: User })[] = useMemo(() => {
    return (student.studentLogins || []).map(login => ({
      ...login,
      user: userMap.get(login.uid),
    }));
  }, [student.studentLogins, userMap]);

  const getUsername = (email: string) => {
    if (!email) return '';
    return email.split('@')[0];
  }

  const handleDelete = async (uid: string, email: string) => {
    setIsMutating(`delete-${uid}`);
    const result = await deleteStudentLogin(student.id, uid, currentUser.id);

    if (result.success) {
      toast({ title: 'Student User Deleted', description: `Login for ${getUsername(email)} has been removed.` });
    } else {
      toast({ variant: 'destructive', title: 'Deletion Failed', description: result.message });
    }
    setIsMutating(null);
  };

  const handleResetPassword = async (email: string) => {
    setIsMutating(`reset-${email}`);
    const result = await resetStudentPassword(email);

    if (result.success) {
      toast({ title: 'Password Reset Email Sent', description: `An email has been sent to ${email} with instructions.` });
    } else {
      toast({ variant: 'destructive', title: 'Reset Failed', description: result.message });
    }
    setIsMutating(null);
  };

  if (!canManage) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Portal Access</CardTitle>
        <CardDescription>
          Create and manage login credentials for the student to access their portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {studentUsers.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentUsers.map(su => (
                <TableRow key={su.uid}>
                  <TableCell className="font-medium">{getUsername(su.email)}</TableCell>
                  <TableCell>{formatDate(su.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResetPassword(su.email)}
                        disabled={!!isMutating}
                      >
                        {isMutating === `reset-${su.email}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                        <span className="ml-2 hidden sm:inline">Reset Password</span>
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm" disabled={!!isMutating}>
                            {isMutating === `delete-${su.uid}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                             <span className="ml-2 hidden sm:inline">Delete</span>
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the login for {getUsername(su.email)}. The student will no longer be able to access their portal. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(su.uid, su.email)}>Delete User</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No student logins created yet.</p>
        )}
      </CardContent>
      <CardFooter className="border-t pt-4">
        <AddStudentUserDialog student={student} currentUser={currentUser}>
            <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add New Login
            </Button>
        </AddStudentUserDialog>
      </CardFooter>
    </Card>
  );
}
