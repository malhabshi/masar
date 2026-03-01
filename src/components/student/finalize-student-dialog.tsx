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
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { setStudentFinalChoice } from '@/lib/actions';
import type { Student, Application } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, GraduationCap, Paperclip } from 'lucide-react';

interface FinalizeStudentDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function FinalizeStudentDialog({ student, currentUser }: FinalizeStudentDialogProps) {
  const { toast } = useToast();
  const [selectedApplication, setSelectedApplication] = useState<Application | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const acceptedApplications = student.applications.filter(app => app.status === 'Accepted');

  const handleFinalize = async () => {
    if (!selectedApplication) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select an application.' });
      return;
    }
    
    setIsFinalizing(true);
    const result = await setStudentFinalChoice(
      student.id,
      selectedApplication.university,
      selectedApplication.major,
      currentUser.id
    );

    if (result.success) {
      toast({
        title: 'Student Finalized',
        description: result.message,
      });
      setIsOpen(false);
      setSelectedApplication(null);
    } else {
      toast({
        variant: 'destructive',
        title: 'Finalization Failed',
        description: result.message,
      });
    }
    setIsFinalizing(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Paperclip className="mr-2 h-4 w-4" />
          Set Final Choice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Final University Choice</DialogTitle>
          <DialogDescription>
            Select one of the accepted applications for {student.name}. This action cannot be undone easily.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <RadioGroup 
            onValueChange={(value) => {
              const app = acceptedApplications.find(a => a.university === value);
              setSelectedApplication(app || null);
            }}
            className="space-y-2"
          >
            {acceptedApplications.length > 0 ? (
              acceptedApplications.map((app, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <RadioGroupItem value={app.university} id={`app-${index}`} />
                  <Label htmlFor={`app-${index}`} className="font-normal cursor-pointer">
                    {app.university} ({app.major}) - {app.country}
                  </Label>
                </div>
              ))
            ) : (
                <p className="text-center text-muted-foreground py-4">No 'Accepted' applications to choose from.</p>
            )}
          </RadioGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
          <Button onClick={handleFinalize} disabled={isFinalizing || !selectedApplication}>
            {isFinalizing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Final Choice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
