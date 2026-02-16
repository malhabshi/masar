
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { requestStudentDeletion } from '@/lib/actions';
import type { Student, User } from '@/lib/types';
import { Loader2, Trash2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';

interface DeleteStudentDialogProps {
  student: Student;
  currentUser: User;
}

const CONFIRMATION_TEXT = 'DELETE';

export function DeleteStudentDialog({ student, currentUser }: DeleteStudentDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const { firestore } = useFirebase();
  const { users } = useUsers();

  const canDelete = confirmation === CONFIRMATION_TEXT;

  const handleRequestDeletion = async () => {
    if (!canDelete || !firestore) return;

    setIsRequesting(true);
    const result = await requestStudentDeletion(student.id, currentUser.id, reason, student.name);

    if (result.success) {
      // Client-side updates
      const studentDocRef = doc(firestore, 'students', student.id);
      updateDocumentNonBlocking(studentDocRef, { deletionRequested: true });
      
      const admins = users.filter(u => u.role === 'admin');
      const message = `DELETION REQUEST\n- Student: ${student.name} (ID: ${student.id})\n- Requested By: ${currentUser.name}\n- Reason: ${reason || 'No reason provided.'}\n\nPlease review and approve this deletion.`;
      const tasksCollection = collection(firestore, 'tasks');
      for (const admin of admins) {
          addDocumentNonBlocking(tasksCollection, {
              authorId: currentUser.id,
              recipientId: admin.id,
              content: message,
              createdAt: new Date().toISOString(),
              status: 'new',
              replies: [],
          });
      }

      toast({
        title: 'Deletion Request Sent',
        description: `Your request to delete ${student.name} has been sent to the admin for approval.`,
      });
      setIsOpen(false);
      setReason('');
      setConfirmation('');
    } else {
      toast({
        variant: 'destructive',
        title: 'Request Failed',
        description: result.message,
      });
    }
    setIsRequesting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Student
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Deletion for {student.name}</DialogTitle>
          <DialogDescription>
            This action will send a deletion request to the administrator. The student profile will be removed upon approval. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
            <Alert variant="destructive">
                <AlertTitle>Warning</AlertTitle>
                <AlertDescription>
                    You are requesting to permanently delete a student profile.
                </AlertDescription>
            </Alert>
            <div className="space-y-2">
                <Label htmlFor="delete-reason">Reason for Deletion</Label>
                <Textarea
                    id="delete-reason"
                    placeholder="Provide a reason for deleting this student..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                />
            </div>
            <div className="space-y-2">
                <Label htmlFor="delete-confirmation">To confirm, type "{CONFIRMATION_TEXT}" below:</Label>
                 <Input
                    id="delete-confirmation"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                />
            </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleRequestDeletion} disabled={!canDelete || isRequesting} variant="destructive">
            {isRequesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Request Deletion
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
