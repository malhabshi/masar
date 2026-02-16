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
import { Loader2 } from 'lucide-react';
import { sendTask, addNote } from '@/lib/actions';
import type { Student, User, Note } from '@/lib/types';
import { useFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

interface InactivityReportDialogProps {
  student: Student;
  currentUser: User;
  users: User[];
}

export function InactivityReportDialog({ student, currentUser, users }: InactivityReportDialogProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [report, setReport] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const admins = users.filter(u => u.role === 'admin');

  const handleSubmitReport = async () => {
    if (!report.trim()) {
      toast({ variant: 'destructive', title: 'Report cannot be empty.' });
      return;
    }
    if (admins.length === 0 || !firestore) {
      toast({ variant: 'destructive', title: 'No admin found to send the report to.' });
      return;
    }

    setIsSubmitting(true);
    const reportContent = `Inactivity Report for ${student.name}:\n\n${report}`;
    
    // 1. Send task to all admins (for notifications) and add to client state
    const tasksCollection = collection(firestore, 'tasks');
    for (const admin of admins) {
      await sendTask(currentUser.id, admin.id, reportContent);
      addDocumentNonBlocking(tasksCollection, {
        authorId: currentUser.id,
        recipientId: admin.id,
        content: reportContent,
        createdAt: new Date().toISOString(),
        status: 'new',
        replies: [],
      });
    }

    // 2. Add a note to the student's profile to reset the inactivity timer
    const noteContent = `Submitted inactivity report: "${report}"`;
    await addNote(student.id, currentUser.id, noteContent);
    const newNote: Note = {
      id: `note-${Date.now()}`,
      authorId: currentUser.id,
      content: noteContent,
      createdAt: new Date().toISOString(),
    };
    
    const studentDocRef = doc(firestore, 'students', student.id);
    updateDocumentNonBlocking(studentDocRef, { notes: [...student.notes, newNote] });
    
    setIsSubmitting(false);
    setIsOpen(false);
    setReport('');
    toast({
      title: 'Report Sent',
      description: `Your inactivity report for ${student.name} has been sent to the admin(s).`,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="ml-4">Write Inactivity Report</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Inactivity Report for {student.name}</DialogTitle>
          <DialogDescription>
            This student has been inactive for over 10 days. Please provide a status update for the admin.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            placeholder="e.g., Have tried contacting the student via phone and email with no response. Will try again next week..."
            value={report}
            onChange={(e) => setReport(e.target.value)}
            className="min-h-[120px]"
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleSubmitReport} disabled={isSubmitting || !report.trim()}>
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit Report
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
