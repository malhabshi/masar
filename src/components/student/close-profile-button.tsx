'use client';

import { useState } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, Lock, LockOpen } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { closeStudentProfile, reopenStudentProfile } from '@/lib/actions';

interface CloseProfileButtonProps {
  student: Student;
  currentUser: AppUser;
}

export function CloseProfileButton({ student, currentUser }: CloseProfileButtonProps) {
  const [isCloseOpen, setIsCloseOpen] = useState(false);
  const [isReopenOpen, setIsReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'adminplus';
  if (!isAdmin) return null;

  const handleClose = async () => {
    if (!reason.trim()) {
      toast({ variant: 'destructive', title: 'Reason Required', description: 'Please enter a reason for closing this profile.' });
      return;
    }
    setIsLoading(true);
    const result = await closeStudentProfile(student.id, reason.trim(), currentUser.id);
    if (result.success) {
      toast({ title: 'Profile Closed', description: result.message });
      setIsCloseOpen(false);
      setReason('');
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsLoading(false);
  };

  const handleReopen = async () => {
    setIsLoading(true);
    const result = await reopenStudentProfile(student.id, currentUser.id);
    if (result.success) {
      toast({ title: 'Profile Reopened', description: result.message });
      setIsReopenOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsLoading(false);
  };

  if (student.isClosed) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsReopenOpen(true)}
          className="bg-green-900 text-green-100 border-green-700 hover:bg-green-800 hover:text-white font-bold"
        >
          <LockOpen className="h-4 w-4 mr-2" />
          Reopen Profile
        </Button>

        <Dialog open={isReopenOpen} onOpenChange={setIsReopenOpen}>
          <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
            <DialogHeader>
              <DialogTitle>Reopen Student Profile</DialogTitle>
              <DialogDescription>
                This will reverse the closure:
                <ul className="list-disc list-inside mt-2 space-y-1 text-[12px]">
                  <li>Remove <strong>CLOSED</strong> status and name suffix</li>
                  <li>Reset pipeline to <strong>No Status</strong></li>
                  <li>Reset all applications back to <strong>Pending</strong></li>
                  <li>Move to <strong>Unassigned</strong> list</li>
                  <li>Resume notifications</li>
                  <li>Note: documents deleted after 30 days must be re-uploaded manually</li>
                </ul>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2 pt-2 border-t">
              <Button
                onClick={handleReopen}
                disabled={isLoading}
                className="w-full bg-green-700 hover:bg-green-800 text-white font-bold gap-2"
              >
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />}
                Confirm Reopen Profile
              </Button>
              <DialogClose asChild>
                <Button variant="ghost" className="w-full" disabled={isLoading}>Cancel</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsCloseOpen(true)}
        className="bg-gray-900 text-white border-gray-700 hover:bg-black hover:text-white font-bold"
      >
        <Lock className="h-4 w-4 mr-2" />
        Close Profile
      </Button>

      <Dialog open={isCloseOpen} onOpenChange={setIsCloseOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Close Student Profile</DialogTitle>
            <DialogDescription>
              This action will:
              <ul className="list-disc list-inside mt-2 space-y-1 text-[12px]">
                <li>Mark the profile as <strong>Closed</strong></li>
                <li>Set pipeline to <strong>Black</strong></li>
                <li>Reject all university applications</li>
                <li>Reassign to <strong>TEST - Talal 2</strong></li>
                <li>Append the reason to the Management Status Note</li>
                <li>Stop all notifications for this profile</li>
              </ul>
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Reason for Closing
              </Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Enter the reason why this profile is being closed..."
                rows={4}
                className="text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-2 border-t">
            <Button
              onClick={handleClose}
              disabled={isLoading || !reason.trim()}
              className="w-full bg-black hover:bg-gray-900 text-white font-bold gap-2"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Confirm Close Profile
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" className="w-full" disabled={isLoading}>Cancel</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
