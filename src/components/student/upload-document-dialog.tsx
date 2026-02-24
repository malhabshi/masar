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
import { useUser } from '@/hooks/use-user';
import { Loader2, UploadCloud } from 'lucide-react';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { validateFile, MAX_FILE_SIZE_MB, ALLOWED_FILE_EXTENSIONS } from '@/lib/file-validation';

interface UploadDocumentDialogProps {
  student: Student;
}

export function UploadDocumentDialog({ student }: UploadDocumentDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [customName, setCustomName] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { user: currentUser, auth: authUser } = useUser();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      const validation = validateFile(selectedFile);
      if (!validation.isValid) {
        toast({
          variant: 'destructive',
          title: 'Invalid File',
          description: validation.message,
        });
        setFile(null);
        if (e.target) e.target.value = ''; // Reset input
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    console.log('1. Starting upload with file:', file);
    if (!file) {
      toast({ variant: 'destructive', title: 'No file selected' });
      return;
    }
    if (!currentUser || !authUser) {
      toast({ variant: 'destructive', title: 'Authentication or database error' });
      return;
    }

    setIsLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'student');
    formData.append('studentId', student.id);
    console.log('2. Destination:', 'student');
    console.log('3. Student ID:', student.id);

    try {
      const token = await authUser.getIdToken();
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      const result = await response.json();
      console.log('4. API response:', result);


      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload file.');
      }

      const { downloadURL } = result;

      const newDocument: StudentDocument = {
        id: `doc-${Date.now()}`,
        name: customName.trim() || file.name,
        originalName: file.name,
        size: file.size,
        url: downloadURL,
        authorId: currentUser.id,
        uploadedAt: new Date().toISOString(),
        isNew: true,
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
        description: `'${newDocument.name}' has been uploaded and added to the student's profile.`,
      });

      setIsOpen(false);
      setFile(null);
      setCustomName('');

    } catch (error: any) {
      console.error('5. Upload error:', error);
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
            Max file size: {MAX_FILE_SIZE_MB}MB. Allowed types: PDF, Word, Excel, Images, Text.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="document-file">File</Label>
            <Input id="document-file" type="file" onChange={handleFileChange} accept={ALLOWED_FILE_EXTENSIONS} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="custom-name">File Name (Optional)</Label>
            <Input 
              id="custom-name" 
              type="text" 
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="e.g., Passport Scan - January"
            />
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
