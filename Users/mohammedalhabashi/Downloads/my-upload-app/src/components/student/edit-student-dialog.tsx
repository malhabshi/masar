
'use client';

import { useState, useEffect } from 'react';
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
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine } from 'lucide-react';
import type { Student } from '@/lib/types';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

const formSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  email: z.string().email(),
  phone: z.string().min(8, { message: 'Phone number must be at least 8 digits.' }),
  customId: z.string().optional(),
});

interface EditStudentDialogProps {
  student: Student;
}

export function EditStudentDialog({ student }: EditStudentDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: student.name,
      email: student.email,
      phone: student.phone,
      customId: student.customId || '',
    },
  });

  useEffect(() => {
    if (isOpen) {
        form.reset({
            name: student.name,
            email: student.email,
            phone: student.phone,
            customId: student.customId || '',
        });
    }
  }, [isOpen, student, form]);
  
  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!firestore) return;
    setIsLoading(true);
    const studentDocRef = doc(firestore, 'students', student.id);
    updateDocumentNonBlocking(studentDocRef, values);

    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 500));

    toast({
        title: 'Student Updated',
        description: 'Student information has been successfully updated.',
    });

    setIsOpen(false);
    setIsLoading(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon">
            <FilePenLine className="h-4 w-4" />
            <span className="sr-only">Edit Student</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Student Information</DialogTitle>
          <DialogDescription>
            Update the main details for {student.name}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
             <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Custom Student ID (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., UNI-12345" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone Number</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
