
'use client';

import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Trash2 } from 'lucide-react';
import type { Student, User } from '@/lib/types';
import { deleteStudentPermanently } from '@/lib/actions';
import { useFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

interface AdminDeleteStudentDialogProps {
  student: Student;
  users: User[];
  currentUser: User;
}

export function AdminDeleteStudentDialog({ student, users, currentUser }: AdminDeleteStudentDialogProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!currentUser || !firestore) {
        toast({
            variant: 'destructive',
            title: 'Authentication Error',
            description: 'Could not identify current user or database.',
        });
        return;
    }
    setIsDeleting(true);
    
    // Simulate server action
    const result = await deleteStudentPermanently(student.id, student.name, currentUser.id);

    if (result.success) {
        // Delete the student doc
        const studentDocRef = doc(firestore, 'students', student.id);
        deleteDocumentNonBlocking(studentDocRef);
        
        // Add task for department users
        const departments = users.filter(u => u.role === 'department');
        const taskContent = `Student ${student.name} was deleted. PLEASE hold all related applications.`;
        const tasksCollection = collection(firestore, 'tasks');
        if (departments.length > 0) {
            for (const dept of departments) {
                const newTask = { authorId: currentUser.id, recipientId: dept.id, content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] };
                addDocumentNonBlocking(tasksCollection, newTask);
            }
        }
        
        toast({
            title: 'Student Deleted',
            description: `${student.name} has been permanently deleted.`,
        });

        // Redirect to dashboard page
        window.location.href = '/dashboard';
    } else {
        toast({
            variant: 'destructive',
            title: 'Deletion Failed',
            description: result.message,
        });
    }

    setIsDeleting(false);
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Review Deletion Request
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            An employee has requested to delete the profile for <strong>{student.name}</strong>. This action is permanent and cannot be undone. All associated data will be removed.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleDelete} disabled={isDeleting} className="bg-destructive hover:bg-destructive/90">
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Delete Permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
