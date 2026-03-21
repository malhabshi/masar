
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
import { Loader2, ShieldAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';
import { useUserCacheById } from '@/hooks/use-user-cache';

interface ApproveDeletionDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function ApproveDeletionDialog({ student, currentUser }: ApproveDeletionDialogProps) {
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();

  const requesterId = student.deletionRequested?.requestedBy;
  const { userMap } = useUserCacheById(requesterId ? [requesterId] : []);
  const requester = requesterId ? userMap.get(requesterId) : null;

  const handleDelete = async () => {
    setIsDeleting(true);
    const result = await deleteStudent(student.id, currentUser.id);

    if (result.success) {
      toast({
        title: 'Student Deleted',
        description: `${student.name} has been permanently removed.`,
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

  if (!student.deletionRequested) return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="destructive">
          <ShieldAlert className="mr-2 h-4 w-4" />
          Approve Deletion
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Approve Deletion for {student.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This action is permanent and cannot be undone.
            <div className="mt-4 p-4 bg-muted rounded-md border">
              <p className="font-semibold">Reason provided by {requester?.name || 'employee'}:</p>
              <blockquote className="mt-2 pl-4 border-l-2 text-muted-foreground italic">
                {student.deletionRequested.reason}
              </blockquote>
            </div>
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
            Confirm Permanent Deletion
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
