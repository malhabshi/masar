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
import { useCollection, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import type { RequestType, Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, ClipboardList, ArrowLeft, Globe } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '../ui/textarea';
import { createStudentTask } from '@/lib/actions';
import { DynamicTaskForm } from './dynamic-task-form';
import { AddCountryForm } from './add-country-form';

const ADD_COUNTRY_ID = '__add_country__';

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
  const [isAddCountry, setIsAddCountry] = useState(false);
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
    if (typeId === ADD_COUNTRY_ID) {
      setIsAddCountry(true);
      setSelectedRequestType(null);
      return;
    }
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

    // Persist under-18 parent/guardian info to the student so future tasks pre-fill it.
    if (data.guardianFirstNameEn || data.guardianLastNameEn || data.guardianDob || data.guardianPhone) {
      try {
        const studentDocRef = doc(firestore, 'students', student.id);
        updateDocumentNonBlocking(studentDocRef, {
          'jotformData.guardianFirstNameEn': data.guardianFirstNameEn || null,
          'jotformData.guardianLastNameEn': data.guardianLastNameEn || null,
          'jotformData.guardianDob': data.guardianDob || null,
          'jotformData.guardianPhone': data.guardianPhone || null,
        } as any);
      } catch { /* best-effort; task creation still proceeds */ }
    }

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
    setIsAddCountry(false);
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
      <DialogContent className={(selectedRequestType || isAddCountry) ? "max-w-3xl max-h-[90vh] overflow-y-auto" : "max-w-md"}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            {(selectedRequestType || isAddCountry) && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedRequestType(null); setIsAddCountry(false); }}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <DialogTitle>
              {isAddCountry ? 'Add Country Application' : selectedRequestType ? `New ${selectedRequestType.name}` : 'Select Request Type'}
            </DialogTitle>
          </div>
          {!selectedRequestType && !isAddCountry && (
            <DialogDescription>
              Choose the type of request you want to submit for {student.name}.
            </DialogDescription>
          )}
        </DialogHeader>

        {isAddCountry ? (
          <AddCountryForm
            student={student}
            currentUser={currentUser}
            onSuccess={handleClose}
            onCancel={() => setIsAddCountry(false)}
          />
        ) : !selectedRequestType ? (
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
                        {student.jotformData?.documents?.passport?.length ? (
                          <>
                            <Separator className="my-1" />
                            <SelectItem value={ADD_COUNTRY_ID}>
                              <span className="flex items-center gap-2 text-primary font-medium">
                                <Globe className="h-3.5 w-3.5" />
                                Add Country Application
                              </span>
                            </SelectItem>
                          </>
                        ) : null}
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
