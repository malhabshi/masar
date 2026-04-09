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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { deleteStudent, rejectStudentDeletion } from '@/lib/actions';
import { Loader2, ShieldAlert, XCircle, CheckCircle } from 'lucide-react';
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
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [mode, setMode] = useState<'view' | 'reject'>('view');
  
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
      setIsOpen(false);
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

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please provide a reason for rejecting this request.' });
      return;
    }
    
    setIsRejecting(true);
    const result = await rejectStudentDeletion(student.id, currentUser.id, rejectionReason);
    
    if (result.success) {
       toast({ title: 'Request Rejected', description: 'The deletion request was rejected.' });
       setRejectionReason('');
       setMode('view');
       setIsOpen(false);
    } else {
       toast({ variant: 'destructive', title: 'Error', description: result.message });
       setIsRejecting(false);
    }
  };

  if (!student.deletionRequested) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(val) => { setIsOpen(val); if (!val) { setMode('view'); setRejectionReason(''); } }}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <ShieldAlert className="mr-2 h-4 w-4" />
          Review Deletion
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Deletion for {student.name}</DialogTitle>
          <DialogDescription>
            This action permanently removes the student from the system.
          </DialogDescription>
        </DialogHeader>
        
        <div className="mt-2 p-4 bg-muted rounded-md border">
          <p className="font-semibold text-sm">Reason provided by {requester?.name || 'employee'}:</p>
          <blockquote className="mt-2 pl-4 border-l-2 text-muted-foreground italic text-sm">
            {student.deletionRequested.reason}
          </blockquote>
        </div>

        {mode === 'reject' && (
          <div className="mt-4 space-y-3">
             <Label>Reason for Rejection</Label>
             <Textarea 
               placeholder="Why is this deletion being rejected?" 
               value={rejectionReason}
               onChange={(e) => setRejectionReason(e.target.value)}
             />
          </div>
        )}

        <DialogFooter className="mt-4 flex flex-col sm:flex-row gap-2">
           {mode === 'view' ? (
             <>
               <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isDeleting}>Cancel</Button>
               <div className="flex-1" />
               <Button variant="outline" className="border-red-500 text-red-600 hover:bg-red-50" onClick={() => setMode('reject')} disabled={isDeleting}>
                  <XCircle className="w-4 h-4 mr-2" />
                  Reject Request
               </Button>
               <Button
                 onClick={handleDelete}
                 disabled={isDeleting}
                 className="bg-destructive hover:bg-destructive/90 text-white"
               >
                 {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                 Approve Permanent Deletion
               </Button>
             </>
           ) : (
             <>
               <Button variant="outline" onClick={() => setMode('view')} disabled={isRejecting}>Cancel</Button>
               <div className="flex-1" />
               <Button
                 onClick={handleReject}
                 disabled={isRejecting || !rejectionReason.trim()}
                 className="bg-destructive hover:bg-destructive/90 text-white"
               >
                 {isRejecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                 Confirm Rejection
               </Button>
             </>
           )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
