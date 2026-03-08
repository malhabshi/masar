'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

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
import { useCollection } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { RequestType, Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, ClipboardList, ArrowLeft } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '../ui/textarea';
import { createStudentTask } from '@/lib/actions';
import { DynamicTaskForm } from './dynamic-task-form';

const selectionSchema = z.object({
  requestTypeId: z.string().min(1, 'Please select a request type.'),
});

interface CreateStudentTaskDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function CreateStudentTaskDialog({ student, currentUser }: CreateStudentTaskDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedRequestType, setSelectedRequestType] = useState<RequestType | null>(null);
  const { toast } = useToast();

  const { data: requestTypes, isLoading: requestTypesLoading } = useCollection<RequestType>('request_types');
  const activeRequestTypes = (requestTypes || []).filter(rt => rt.isActive);

  const selectionForm = useForm<z.infer<typeof selectionSchema>>({
    resolver: zodResolver(selectionSchema),
    defaultValues: {
      requestTypeId: '',
    },
  });

  const handleTypeSelect = (typeId: string) => {
    const type = activeRequestTypes.find(rt => rt.id === typeId);
    setSelectedRequestType(type || null);
  };

  const handleSimpleSubmit = async (values: { description: string }) => {
    if (!selectedRequestType) return;
    
    setIsSubmitting(true);
    const result = await createStudentTask(
      currentUser.id, 
      student.id, 
      selectedRequestType.id, 
      values.description
    );

    if (result.success) {
      toast({ title: 'Task Created', description: result.message });
      handleClose();
    } else {
      toast({ variant: 'destructive', title: 'Failed to create task', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleDynamicSubmit = async (data: any) => {
    if (!selectedRequestType) return;
    
    setIsSubmitting(true);
    // Dynamic forms usually have their own summary/description or we generate one
    const description = data.notes || `Dynamic request: ${selectedRequestType.name}`;
    
    const result = await createStudentTask(
      currentUser.id,
      student.id,
      selectedRequestType.id,
      description,
      data
    );

    if (result.success) {
      toast({ title: 'Task Created', description: result.message });
      handleClose();
    } else {
      toast({ variant: 'destructive', title: 'Failed to create task', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setSelectedRequestType(null);
    selectionForm.reset();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogTrigger asChild>
        <Button onClick={() => setIsOpen(true)}>
          <ClipboardList className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent className={selectedRequestType ? "max-w-3xl max-h-[90vh] overflow-y-auto" : "max-w-md"}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            {selectedRequestType && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSelectedRequestType(null)}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>
              {selectedRequestType ? `New ${selectedRequestType.name}` : 'Select Request Type'}
            </DialogTitle>
          </div>
          {!selectedRequestType && (
            <DialogDescription>
              Choose the type of request you want to submit for {student.name}.
            </DialogDescription>
          )}
        </DialogHeader>

        {!selectedRequestType ? (
          <Form {...selectionForm}>
            <form className="space-y-4 py-4">
              <FormField
                control={selectionForm.control}
                name="requestTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Request Type</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); handleTypeSelect(val); }} defaultValue={field.value} disabled={requestTypesLoading}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={requestTypesLoading ? 'Loading types...' : 'Select a request type'} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {activeRequestTypes.map(rt => (
                          <SelectItem key={rt.id} value={rt.id}>{rt.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              </DialogFooter>
            </form>
          </Form>
        ) : (
          <DynamicTaskForm 
            student={student} 
            requestType={selectedRequestType} 
            onSubmit={handleDynamicSubmit}
            onCancel={() => setSelectedRequestType(null)}
            isSubmitting={isSubmitting}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
