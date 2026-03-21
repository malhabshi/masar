'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentIELTS } from '@/lib/actions';

// UI Imports
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine } from 'lucide-react';

// Schema for the dialog form
const ieltsFormSchema = z.object({
  overallScore: z.coerce.number().min(0, "Score must be at least 0.").max(9, "Score must be at most 9."),
});

interface IeltsCardProps {
  student: Student;
  currentUser: AppUser;
}

// Dialog component, internal to the card
function EditIeltsDialog({ student, currentUser, children }: { student: Student; currentUser: AppUser; children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const form = useForm<z.infer<typeof ieltsFormSchema>>({
        resolver: zodResolver(ieltsFormSchema),
        defaultValues: {
        overallScore: student.ieltsOverall ?? 0,
        },
    });

    useEffect(() => {
        if (isOpen) {
        form.reset({
            overallScore: student.ieltsOverall ?? 0,
        });
        }
    }, [isOpen, student.ieltsOverall, form]);

    async function onSubmit(values: z.infer<typeof ieltsFormSchema>) {
        setIsLoading(true);
        const result = await updateStudentIELTS(student.id, values.overallScore, currentUser.id);

        if (result.success) {
            toast({ title: 'IELTS Score Updated', description: result.message });
            setIsOpen(false);
        } else {
            toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
        }
        setIsLoading(false);
    }
    
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>{children}</DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Edit IELTS Score</DialogTitle>
                    <DialogDescription>Update the student's overall IELTS score. Set to 0 if not applicable.</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="overallScore"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Overall Band Score</FormLabel>
                                <FormControl>
                                    <Input type="number" step="0.5" min="0" max="9" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Score
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

// Main card component
export function IeltsCard({ student, currentUser }: IeltsCardProps) {
  const isAssignedEmployee = currentUser.civilId === student.employeeId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>IELTS Overall Score</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold">
          {student.ieltsOverall != null ? student.ieltsOverall.toFixed(1) : 'Not Added'}
        </p>
      </CardContent>
      {isAssignedEmployee && (
        <CardFooter className="border-t pt-4">
            <EditIeltsDialog student={student} currentUser={currentUser}>
                <Button variant="outline">
                    <FilePenLine className="mr-2 h-4 w-4" />
                    Edit Score
                </Button>
            </EditIeltsDialog>
        </CardFooter>
      )}
    </Card>
  );
}
