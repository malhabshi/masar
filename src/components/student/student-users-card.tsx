'use client';

import { useState } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { deleteStudentLogin } from '@/lib/actions';

// UI Components
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { PlusCircle, Trash2, Loader2, Key } from 'lucide-react';
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

  const handleDelete = async (id: string, description: string) => {
    setIsMutating(`delete-${id}`);
    const result = await deleteStudentLogin(student.id, id, currentUser.id);

    if (result.success) {
      toast({ title: 'Record Deleted', description: `Login reference for ${description} has been removed.` });
    } else {
      toast({ variant: 'destructive', title: 'Deletion Failed', description: result.message });
    }
    setIsMutating(null);
  };
  
  if (!canManage) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            External Portal References
        </CardTitle>
        <CardDescription>
          Store and reference credentials for external student portals (e.g. MOHE, University sites).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {student.studentLogins && student.studentLogins.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Portal / Website</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Password</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.studentLogins.map(su => (
                <TableRow key={su.id}>
                  <TableCell className="font-medium">{su.description}</TableCell>
                  <TableCell className="font-mono text-xs">{su.username}</TableCell>
                  <TableCell className="font-mono text-xs">{su.password || '---'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{su.notes || '---'}</TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="icon" className="h-8 w-8" disabled={!!isMutating}>
                          {isMutating === `delete-${su.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will permanently delete the login reference for {su.description}.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(su.id, su.description)}>Delete Record</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No portal references added yet.</p>
        )}
      </CardContent>
      <CardFooter className="border-t pt-4">
        <AddStudentUserDialog student={student} currentUser={currentUser}>
            <Button variant="outline">
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Portal Reference
            </Button>
        </AddStudentUserDialog>
      </CardFooter>
    </Card>
  );
}
