'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine } from 'lucide-react';
import type { Student, User, IeltsScore } from '@/lib/types';
import { updateIeltsScore } from '@/lib/actions';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

// Schema only validates the overall score now
const formSchema = z.object({
  overall: z.coerce.number().min(0).max(9),
});

type IeltsFormData = z.infer<typeof formSchema>;

interface IeltsSectionProps {
  student: Student;
  currentUser: User;
}

export function IeltsSection({ student, currentUser }: IeltsSectionProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [isEditing, setIsEditing] = useState(!student.ielts);
  const [isSaving, setIsSaving] = useState(false);

  const canEdit = currentUser.civilId === student.employeeId;

  const form = useForm<IeltsFormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      overall: student.ielts?.overall || 0,
    },
  });

  const handleEdit = () => {
    form.reset({ overall: student.ielts?.overall || 0 });
    setIsEditing(true);
  };

  const handleCancel = () => {
    if (student.ielts) {
        form.reset({ overall: student.ielts.overall });
        setIsEditing(false);
    }
  };

  const onSubmit = async (values: IeltsFormData) => {
    setIsSaving(true);
    
    // Construct the full IeltsScore object, preserving other scores
    const existingScores = student.ielts || { listening: 0, reading: 0, writing: 0, speaking: 0, overall: 0 };
    const scoresToSave: IeltsScore = {
        ...existingScores,
        overall: values.overall,
    };

    const result = await updateIeltsScore(student.id, scoresToSave);
    if (result.success) {
      if (firestore) {
        const studentDocRef = doc(firestore, 'students', student.id);
        updateDocumentNonBlocking(studentDocRef, { ielts: scoresToSave });
      }
      toast({ title: 'IELTS Score Updated', description: result.message });
      setIsEditing(false);
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsSaving(false);
  };
  
  const renderScoreDisplay = (label: string, score: number | undefined) => (
    <div className="flex flex-col items-center justify-center p-3 bg-muted rounded-lg w-full">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-bold text-primary">{score?.toFixed(1) ?? 'N/A'}</span>
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>IELTS Score</CardTitle>
        {canEdit && student.ielts && !isEditing && (
            <Button variant="ghost" size="icon" onClick={handleEdit}>
                <FilePenLine className="h-4 w-4" />
            </Button>
        )}
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent>
            {!isEditing && student.ielts ? (
              <div className="text-center">
                {renderScoreDisplay("Overall", student.ielts.overall)}
              </div>
            ) : canEdit ? (
                <div className="space-y-4">
                    <FormField control={form.control} name="overall" render={({ field }) => (
                        <FormItem>
                            <FormLabel>Overall Score</FormLabel>
                            <FormControl>
                                <Input type="number" step="0.5" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                </div>
            ) : (
                <div className="text-sm text-muted-foreground text-center py-8">
                    No IELTS scores have been recorded for this student.
                </div>
            )}
          </CardContent>
          {isEditing && canEdit && (
            <CardFooter className="flex justify-end gap-2 border-t pt-6">
                <Button variant="ghost" type="button" onClick={handleCancel}>Cancel</Button>
                <Button type="submit" disabled={isSaving}>
                    {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save Score
                </Button>
            </CardFooter>
          )}
        </form>
      </Form>
    </Card>
  );
}
