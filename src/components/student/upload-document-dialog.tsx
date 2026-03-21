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
import type { Student } from '@/lib/types';
import { useUser } from '@/hooks/use-user';
import { Loader2, UploadCloud } from 'lucide-react';
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
  const { auth: authUser } = useUser();

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
    if (!file) {
      toast({ variant: 'destructive', title: 'No file selected' });
      return;
    }
    if (!authUser) {
      toast({ variant: 'destructive', title: 'Authentication error. Please refresh and try again.' });
      return;
    }

    setIsLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'student');
    formData.append('studentId', student.id);
    if (customName) {
        formData.append('customName', customName);
    }


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
      
      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to upload file and update database.');
      }
      
      toast({
        title: 'Upload Successful',
        description: `'${result.document.name}' has been uploaded and added to the student's profile.`,
      });

      setIsOpen(false);
      setFile(null);
      setCustomName('');

    } catch (error: any) {
      console.error('Upload error:', error);
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
