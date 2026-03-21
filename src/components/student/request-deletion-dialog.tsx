
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { requestStudentDeletion } from '@/lib/actions';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, Trash2 } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';

const formSchema = z.object({
  reason: z.string().min(10, { message: 'Please provide a reason with at least 10 characters.' }),
  confirm: z.literal(true, {
    errorMap: () => ({ message: "You must confirm to proceed." })
  })
});

interface RequestDeletionDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function RequestDeletionDialog({ student, currentUser }: RequestDeletionDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: '' },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsRequesting(true);
    const result = await requestStudentDeletion(student.id, currentUser.id, values.reason);

    if (result.success) {
      toast({
        title: 'Request Submitted',
        description: 'Your request to delete this student has been sent to an administrator for review.',
      });
      setIsOpen(false);
      form.reset();
    } else {
      toast({
        variant: 'destructive',
        title: 'Request Failed',
        description: result.message,
      });
    }
    setIsRequesting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10 hover:text-destructive">
          <Trash2 className="mr-2 h-4 w-4" />
          Request Deletion
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Deletion for {student.name}</DialogTitle>
          <DialogDescription>
            This will send a request to an administrator to permanently delete this student's profile and all associated data.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Deletion Request</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Student is no longer interested, duplicate profile, etc."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirm"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                   <FormControl>
                     <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>
                      I understand this will request permanent deletion.
                    </FormLabel>
                    <FormMessage/>
                  </div>
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isRequesting} variant="destructive">
                {isRequesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
