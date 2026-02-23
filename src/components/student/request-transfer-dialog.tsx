
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
import { requestTransfer } from '@/lib/actions';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, ArrowRightLeft } from 'lucide-react';

const formSchema = z.object({
  reason: z.string().min(10, { message: 'Please provide a reason with at least 10 characters.' }),
});

interface RequestTransferDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function RequestTransferDialog({ student, currentUser }: RequestTransferDialogProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isRequesting, setIsRequesting] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { reason: '' },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsRequesting(true);
    const result = await requestTransfer(student.id, values.reason, currentUser.id, student.name);

    if (result.success) {
      toast({
        title: 'Request Submitted',
        description: result.message,
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
        <Button variant="outline">
          <ArrowRightLeft className="mr-2 h-4 w-4" />
          Request Transfer
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request Student Transfer</DialogTitle>
          <DialogDescription>
            Submit a request to transfer "{student.name}" to another employee. An admin will review this request.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason for Transfer</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Student has requested a different contact, or I am unable to handle their case..."
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
              <Button type="submit" disabled={isRequesting}>
                {isRequesting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Submit Request
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
