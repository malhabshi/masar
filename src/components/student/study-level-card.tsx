'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentStudyLevel } from '@/lib/actions';

// UI Imports
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine, BookOpen } from 'lucide-react';

const studyLevelFormSchema = z.object({
  level: z.enum(['Foundation', 'First Year', 'Transfer Student'], {
    required_error: 'Please select a study level.',
  }),
});

interface StudyLevelCardProps {
  student: Student;
  currentUser: AppUser;
}

function EditStudyLevelDialog({ student, currentUser, children }: { student: Student; currentUser: AppUser; children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const form = useForm<z.infer<typeof studyLevelFormSchema>>({
        resolver: zodResolver(studyLevelFormSchema),
        defaultValues: {
            level: student.studyLevel || 'Foundation',
        },
    });

    useEffect(() => {
        if (isOpen && student.studyLevel) {
            form.reset({
                level: student.studyLevel,
            });
        }
    }, [isOpen, student.studyLevel, form]);

    async function onSubmit(values: z.infer<typeof studyLevelFormSchema>) {
        setIsLoading(true);
        const result = await updateStudentStudyLevel(student.id, values.level, currentUser.id);

        if (result.success) {
            toast({ title: 'Study Level Updated', description: result.message });
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
                    <DialogTitle>Edit Study Level</DialogTitle>
                    <DialogDescription>Choose if the student is in foundation or first year.</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="level"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Study Level</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger>
                                                <SelectValue placeholder="Select study level" />
                                            </SelectTrigger>
                                        </FormControl>
                                        <SelectContent>
                                            <SelectItem value="Foundation">Foundation</SelectItem>
                                            <SelectItem value="First Year">First Year</SelectItem>
                                            <SelectItem value="Transfer Student">Transfer Student</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Level
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export function StudyLevelCard({ student, currentUser }: StudyLevelCardProps) {
  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);
  const canEdit = isAssignedEmployee || isAdminOrDept;

  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Study Level</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-black text-primary">
          {student.studyLevel || 'Not Set'}
        </p>
      </CardContent>
      {canEdit && (
        <CardFooter className="border-t pt-4">
            <EditStudyLevelDialog student={student} currentUser={currentUser}>
                <Button variant="outline" size="sm" className="font-bold">
                    <FilePenLine className="mr-2 h-4 w-4" />
                    Edit Study Level
                </Button>
            </EditStudyLevelDialog>
        </CardFooter>
      )}
    </Card>
  );
}
