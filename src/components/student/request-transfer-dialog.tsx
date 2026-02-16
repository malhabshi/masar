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
import { useToast } from '@/hooks/use-toast';
import { sendTask } from '@/lib/actions';
import type { Student, User } from '@/lib/types';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { useFirebase, updateDocumentNonBlocking, addDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

interface RequestTransferDialogProps {
  student: Student;
  currentUser: User;
  users: User[];
}

export function RequestTransferDialog({ student, currentUser, users }: RequestTransferDialogProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [reason, setReason] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);
  const admins = users.filter(u => u.role === 'admin');

  const handleRequestTransfer = async () => {
    if (admins.length === 0 || !firestore) {
        toast({ variant: 'destructive', title: 'Error', description: 'No admin users found to send the request to.' });
        return;
    }
    setIsRequesting(true);
    const message = `Transfer Request for ${student.name} from ${currentUser.name}.\n\nReason: ${reason || 'No reason provided.'}`;
    
    // Server action for side-effects like notifications
    for (const admin of admins) {
        await sendTask(currentUser.id, admin.id, message);
    }

    // Client-side state updates
    if (admins.length > 0) {
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

      const studentDocRef = doc(firestore, 'students', student.id);
      updateDocumentNonBlocking(studentDocRef, { transferRequested: true });

      toast({
        title: 'Transfer Request Sent',
        description: `Your request to transfer ${student.name} has been sent to the admin(s).`,
      });
      setIsOpen(false);
      setReason('');
    } else {
      toast({
        variant: 'destructive',
        title: 'Request Failed',
        description: 'Could not send transfer request.',
      });
    }
    setIsRequesting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ArrowRightLeft className="mr-2 h-4 w-4" />
          Request Transfer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Transfer for {student.name}</DialogTitle>
          <DialogDescription>
            This will send a task to the administrator to request a transfer for this student. You can provide a reason below.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
            <Textarea
                placeholder="Provide a reason for the transfer request (optional)..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
            />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleRequestTransfer} disabled={isRequesting}>
            {isRequesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
