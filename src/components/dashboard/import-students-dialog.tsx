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
import type { AppUser } from '@/hooks/use-user';
import { importStudentsFromExcel } from '@/lib/actions';
import { Loader2, FileUp } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';

interface ImportStudentsDialogProps {
  currentUser: AppUser;
}

export function ImportStudentsDialog({ currentUser }: ImportStudentsDialogProps) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFile(e.target.files[0]);
    }
  };

  const handleImport = async () => {
    if (!file) {
      toast({ variant: 'destructive', title: 'No file selected', description: 'Please select an Excel file to import.' });
      return;
    }
    if (!currentUser) {
        toast({ variant: 'destructive', title: 'Authentication error', description: 'Could not identify the current user.' });
        return;
    }

    setIsLoading(true);
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('userId', currentUser.id);

    const result = await importStudentsFromExcel(formData);

    if (result.success) {
      toast({
        title: 'Import Complete',
        description: result.message,
      });
      setIsOpen(false);
      setFile(null);
    } else {
      toast({
        variant: 'destructive',
        title: 'Import Failed',
        description: result.message,
        duration: 9000, // Show longer for detailed error messages
      });
    }
    setIsLoading(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileUp className="mr-2 h-4 w-4" />
          Import Students
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Students from Excel</DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx, .xls, .csv) to bulk-create student profiles.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <Alert>
            <AlertTitle>File Format</AlertTitle>
            <AlertDescription>
                Ensure your file has columns for 'Name', 'Email', and 'Phone'. Any additional columns will be ignored.
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            <Label htmlFor="import-file">Excel File</Label>
            <Input id="import-file" type="file" accept=".xlsx, .xls, .csv" onChange={handleFileChange} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleImport} disabled={isLoading || !file}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
