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
import { declineTransfer } from '@/lib/actions';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, XCircle } from 'lucide-react';

const formSchema = z.object({
  reason: z.string().optional(),
});

interface DeclineTransferDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function DeclineTransferDialog({ student, currentUser }: DeclineTransferDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: '' },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsDeclining(true);
    const result = await declineTransfer(student.id, currentUser.id, values.reason);

    if (result.success) {
      toast({ title: 'Transfer Declined', description: result.message });
      setIsOpen(false);
      form.reset();
    } else {
      toast({ variant: 'destructive', title: 'Decline Failed', description: result.message });
    }
    setIsDeclining(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="border-destructive text-destructive hover:bg-destructive/10 hover:text-destructive">
          <XCircle className="mr-2 h-4 w-4" />
          Decline Transfer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Decline Transfer for {student.name}</DialogTitle>
          <DialogDescription>
            This rejects the pending transfer request. The student stays with the current employee, and the employee who requested the transfer is notified.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Keeping the student with the current employee for continuity..."
                      rows={4}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={isDeclining}>
                {isDeclining ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Decline Transfer
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
