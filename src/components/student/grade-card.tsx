'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentGrade } from '@/lib/actions';

// UI Imports
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine, Award } from 'lucide-react';

const gradeFormSchema = z.object({
  grade: z.string().min(1, "Grade cannot be empty."),
});

interface GradeCardProps {
  student: Student;
  currentUser: AppUser;
}

function EditGradeDialog({ student, currentUser, children }: { student: Student; currentUser: AppUser; children: React.ReactNode }) {
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const { toast } = useToast();

    const form = useForm<z.infer<typeof gradeFormSchema>>({
        resolver: zodResolver(gradeFormSchema),
        defaultValues: {
            grade: student.highSchoolGrade || '',
        },
    });

    useEffect(() => {
        if (isOpen) {
            form.reset({
                grade: student.highSchoolGrade || '',
            });
        }
    }, [isOpen, student.highSchoolGrade, form]);

    async function onSubmit(values: z.infer<typeof gradeFormSchema>) {
        setIsLoading(true);
        const result = await updateStudentGrade(student.id, values.grade, currentUser.id);

        if (result.success) {
            toast({ title: 'Grade Updated', description: result.message });
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
                    <DialogTitle>Edit High School Grade / GPA</DialogTitle>
                    <DialogDescription>Update the student's high school performance score (e.g., 95% or 3.8).</DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                        <FormField
                            control={form.control}
                            name="grade"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Grade / GPA Value</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g., 98% or 3.9 GPA" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                        />
                        <DialogFooter>
                            <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
                            <Button type="submit" disabled={isLoading}>
                                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Save Grade
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}

export function GradeCard({ student, currentUser }: GradeCardProps) {
  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);
  const canEdit = isAssignedEmployee || isAdminOrDept;

  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">High School Grade / GPA</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-black text-primary">
          {student.highSchoolGrade || 'Not Added'}
        </p>
      </CardContent>
      {canEdit && (
        <CardFooter className="border-t pt-4">
            <EditGradeDialog student={student} currentUser={currentUser}>
                <Button variant="outline" size="sm" className="font-bold">
                    <FilePenLine className="mr-2 h-4 w-4" />
                    Edit Grade
                </Button>
            </EditGradeDialog>
        </CardFooter>
      )}
    </Card>
  );
}
