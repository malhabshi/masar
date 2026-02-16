
'use client';

import { useState } from 'react';
import type { Student, User, RequestType } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { PlusCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { Textarea } from '../ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { submitCustomRequest } from '@/lib/actions';
import { useFirebase, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';

interface NewRequestDialogProps {
  student: Student;
  currentUser: User;
  users: User[];
  requestTypes: RequestType[];
}

export function NewRequestDialog({ student, currentUser, users, requestTypes }: NewRequestDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<'list' | 'form'>('list');
  const [selectedRequestType, setSelectedRequestType] = useState<RequestType | null>(null);
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const handleSelectRequestType = (requestType: RequestType) => {
    setSelectedRequestType(requestType);
    setView('form');
  };

  const handleBack = () => {
    setView('list');
    setSelectedRequestType(null);
    setDetails('');
  };
  
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (!open) {
      // Reset state when dialog closes
      setTimeout(() => {
        setView('list');
        setSelectedRequestType(null);
        setDetails('');
        setIsSubmitting(false);
      }, 300);
    }
  }

  const handleSubmit = async () => {
    if (!selectedRequestType || !details.trim() || !firestore) {
        toast({ variant: 'destructive', title: 'Details are required.' });
        return;
    }
    setIsSubmitting(true);
    const result = await submitCustomRequest(student.id, currentUser.id, selectedRequestType.id, details, student.name);
    if (result.success) {
        toast({ title: 'Request Submitted', description: result.message });
        
        const taskContent = `New Request: "${selectedRequestType.name}" for student ${student.name} from ${currentUser.name}.\n\nDetails: ${details}`;
        const tasksCollection = collection(firestore, 'tasks');

        if (selectedRequestType.defaultRecipientId === 'admins') {
            const admins = users.filter(user => user.role === 'admin');
            for (const admin of admins) {
                addDocumentNonBlocking(tasksCollection, { authorId: currentUser.id, recipientId: admin.id, content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] });
            }
        } else if (selectedRequestType.defaultRecipientId === 'departments') {
            const departments = users.filter(user => user.role === 'department');
            for (const department of departments) {
                addDocumentNonBlocking(tasksCollection, { authorId: currentUser.id, recipientId: department.id, content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] });
            }
        } else {
            addDocumentNonBlocking(tasksCollection, { authorId: currentUser.id, recipientId: selectedRequestType.defaultRecipientId, content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] });
        }

        handleOpenChange(false);
    } else {
        toast({ variant: 'destructive', title: 'Submission Failed', description: result.message });
    }
    setIsSubmitting(false);
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          New Request
        </Button>
      </DialogTrigger>
      <DialogContent onInteractOutside={(e) => { if (isSubmitting) e.preventDefault(); }} className="sm:max-w-[525px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {view === 'form' && (
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>
                {view === 'list' ? 'Create New Request' : selectedRequestType?.name}
              </DialogTitle>
              <DialogDescription>
                {view === 'list'
                  ? `Select a request type for ${student.name}.`
                  : selectedRequestType?.description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="py-4">
          {view === 'list' ? (
            <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
              {requestTypes.length > 0 ? requestTypes.map(rt => (
                <button
                  key={rt.id}
                  onClick={() => handleSelectRequestType(rt)}
                  className="w-full text-left p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <p className="font-semibold">{rt.name}</p>
                  <p className="text-sm text-muted-foreground">{rt.description}</p>
                </button>
              )) : (
                <p className="text-center text-muted-foreground">No request types have been configured.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                placeholder={`Provide details for "${selectedRequestType?.name}"...`}
                className="min-h-[120px]"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
              />
            </div>
          )}
        </div>
        {view === 'form' && (
            <DialogFooter>
                <Button variant="outline" onClick={handleBack}>Back</Button>
                <Button onClick={handleSubmit} disabled={isSubmitting || !details.trim()}>
                    {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Submit Request
                </Button>
            </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
