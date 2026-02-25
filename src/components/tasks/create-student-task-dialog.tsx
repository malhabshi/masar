
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
import { Loader2, ClipboardList } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '../ui/textarea';
import { createStudentTask } from '@/lib/actions';

const formSchema = z.object({
  requestTypeId: z.string().min(1, 'Please select a request type.'),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
});

interface CreateStudentTaskDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function CreateStudentTaskDialog({ student, currentUser }: CreateStudentTaskDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: requestTypes, isLoading: requestTypesLoading } = useCollection<RequestType>('request_types');
  const activeRequestTypes = (requestTypes || []).filter(rt => rt.isActive);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      requestTypeId: '',
      description: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true);
    const result = await createStudentTask(currentUser.id, student.id, values.requestTypeId, values.description);

    if (result.success) {
      toast({ title: 'Task Created', description: result.message });
      setIsOpen(false);
      form.reset();
    } else {
      toast({ variant: 'destructive', title: 'Failed to create task', description: result.message });
    }
    setIsSubmitting(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <ClipboardList className="mr-2 h-4 w-4" />
          New Task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a New Task for {student.name}</DialogTitle>
          <DialogDescription>
            Select a request type and add a description. The task will be routed to the appropriate admin or department.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="requestTypeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value} disabled={requestTypesLoading}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={requestTypesLoading ? 'Loading...' : 'Select a request type'} />
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
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Provide details for your request..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Create Task'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
