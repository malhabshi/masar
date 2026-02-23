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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { Student, Document as StudentDocument } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, UploadCloud } from 'lucide-react';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';

interface UploadDocumentDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function UploadDocumentDialog({ student, currentUser }: UploadDocumentDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast({ variant: 'destructive', title: 'No file selected' });
      return;
    }
    if (!currentUser) {
      toast({ variant: 'destructive', title: 'Authentication or database error' });
      return;
    }

    setIsLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'student');
    formData.append('studentId', student.id);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload file.');
      }

      const { downloadURL } = result;

      const newDocument: StudentDocument = {
        id: `doc-${Date.now()}`,
        name: file.name,
        url: downloadURL,
        authorId: currentUser.id,
        uploadedAt: new Date().toISOString(),
        isNew: true, // Flag for notifications
      };
      
      const studentDocRef = doc(firestore, 'students', student.id);
      const updatedDocuments = [...(student.documents || []), newDocument];
      
      const updates: Partial<Student> = { documents: updatedDocuments };
      if (currentUser.role === 'employee') {
          updates.newDocumentsForAdmin = (student.newDocumentsForAdmin || 0) + 1;
      } else if (['admin', 'department'].includes(currentUser.role)) {
          updates.newDocumentsForEmployee = (student.newDocumentsForEmployee || 0) + 1;
      }

      updateDocumentNonBlocking(studentDocRef, updates);

      toast({
        title: 'Upload Successful',
        description: `'${file.name}' has been uploaded and added to the student's profile.`,
      });

      setIsOpen(false);
      setFile(null);

    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: error.message || 'An unexpected error occurred.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <UploadCloud className="mr-2 h-4 w-4" />
          Upload Document
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload Document for {student.name}</DialogTitle>
          <DialogDescription>
            The uploaded file will be added to the student's document list.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file">File</Label>
            <Input id="document-file" type="file" onChange={handleFileChange} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleUpload} disabled={isLoading || !file}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
