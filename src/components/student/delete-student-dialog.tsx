
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
import { deleteStudent } from '@/lib/actions';
import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/hooks/use-user';

interface DeleteStudentDialogProps {
  studentId: string;
  studentName: string;
  currentUser: AppUser;
}

export function DeleteStudentDialog({ studentId, studentName, currentUser }: DeleteStudentDialogProps) {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteStudent(studentId, currentUser.id);

    if (result.success) {
      toast({
        title: 'Student Deleted',
        description: `${studentName} has been permanently removed from the system.`,
      });
      router.push('/applicants');
    } else {
      toast({
        variant: 'destructive',
        title: 'Deletion Failed',
        description: result.message,
      });
      setIsDeleting(false);
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Student
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the student profile for{' '}
            <strong>{studentName}</strong> and remove all associated data, including applications, documents, and chat history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDelete}
            disabled={isDeleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Yes, delete student
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
