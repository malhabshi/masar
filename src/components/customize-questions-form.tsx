import { useEffect } from "react";
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Trash2, PlusCircle, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { ApplicationQuestion } from '@/lib/types';
import { useUser } from '@/hooks/use-user';


const questionSchema = z.object({
  questionText: z.string().min(5, 'Question text must be at least 5 characters.'),
  questionType: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  isRequired: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

function QuestionForm({
  form,
  onSubmit,
  isLoading,
  submitButtonText
}: {
  form: any;
  onSubmit: (values: z.infer<typeof questionSchema>) => void;
  isLoading: boolean;
  submitButtonText: string;
}) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
        <FormField
          control={form.control}
          name="questionText"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Question Text</FormLabel>
              <FormControl>
                <Textarea placeholder="e.g., What is your intended major?" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="questionType"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Question Type</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a question type" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {['text', 'textarea', 'number', 'date', 'select', 'checkbox'].map(type => (
                    <SelectItem key={type} value={type}>{type.charAt(0).toUpperCase() + type.slice(1)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex gap-4">
          <FormField
            control={form.control}
            name="isRequired"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    id="is-required-switch"
                  />
                </FormControl>
                <FormLabel htmlFor="is-required-switch" className="!mt-0">Required</FormLabel>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="isActive"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    id="is-active-switch"
                  />
                </FormControl>
                <FormLabel htmlFor="is-active-switch" className="!mt-0">Active</FormLabel>
              </FormItem>
            )}
          />
        </div>
        <DialogFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitButtonText}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

export function CustomizeQuestionsForm() {
  const { user: currentUser } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const questionsCollection = useMemo(() => !firestore ? null : collection(firestore, 'application_questions'), [firestore]);
  const { data: questions, isLoading: areQuestionsLoading } = useCollection<ApplicationQuestion>(questionsCollection);

  const [isAddDialogOpen, setAddDialogOpen] = useState(false);
  const [questionToEdit, setQuestionToEdit] = useState<ApplicationQuestion | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const addForm = useForm<z.infer<typeof questionSchema>>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      questionText: '',
      questionType: 'text',
      isRequired: true,
      isActive: true
    },
  });

  const editForm = useForm<z.infer<typeof questionSchema>>({
    resolver: zodResolver(questionSchema)
  });

  useEffect(() => {
    if (questionToEdit) {
      editForm.reset({
        questionText: questionToEdit.questionText,
        questionType: questionToEdit.questionType,
        isRequired: questionToEdit.isRequired,
        isActive: questionToEdit.isActive,
      });
    }
  }, [questionToEdit, editForm]);


  const handleAddQuestion = async (values: z.infer<typeof questionSchema>) => {
    if (!questionsCollection) return;
    setIsSubmitting(true);

    const newQuestion: Omit<ApplicationQuestion, 'id'> = {
      ...values,
      sortOrder: (questions?.length || 0) + 1,
      createdAt: new Date().toISOString(),
    };

    await addDocumentNonBlocking(questionsCollection, newQuestion);
    toast({ title: 'Question Added' });

    setIsSubmitting(false);
    setAddDialogOpen(false);
    addForm.reset();
  };

  const handleUpdateQuestion = async (values: z.infer<typeof questionSchema>) => {
    if (!questionToEdit || !firestore) return;
    setIsSubmitting(true);

    const questionDocRef = doc(firestore, 'application_questions', questionToEdit.id);
    const updatedData = {
      ...values,
      updatedAt: new Date().toISOString(),
    };

    await updateDocumentNonBlocking(questionDocRef, updatedData);
    toast({ title: 'Question Updated' });

    setIsSubmitting(false);
    setQuestionToEdit(null);
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!firestore) return;
    const questionDocRef = doc(firestore, 'application_questions', questionId);
    await deleteDocumentNonBlocking(questionDocRef);
    toast({ title: 'Question Removed' });
  };
  
  const sortedQuestions = useMemo(() => {
    return questions ? [...questions].sort((a, b) => a.sortOrder - b.sortOrder) : [];
  }, [questions]);

  return (
    <>
      <div className="max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>Application Questions</CardTitle>
            <CardDescription>
              Add, edit, or delete questions for the new student application form.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {areQuestionsLoading ? (
              <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
            ) : (
              <div className="space-y-2">
                {sortedQuestions.length > 0 ? (
                  sortedQuestions.map((q, i) => (
                    <div key={q.id} className="flex items-center justify-between p-2 rounded-md group hover:bg-muted/50">
                      <span className="flex-1 pr-4">{i + 1}. {q.questionText}</span>
                      <div className="flex items-center gap-2">
                         <span className="text-xs text-muted-foreground capitalize">{q.questionType}</span>
                         {q.isActive ? <span className="text-xs text-green-600">Active</span> : <span className="text-xs text-red-600">Inactive</span>}
                         <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setQuestionToEdit(q)}>
                                <Pencil className="h-4 w-4" />
                            </Button>
                            <AlertDialog>
                                <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                    This action will permanently delete this question.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteQuestion(q.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                         </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">No questions have been added yet.</p>
                )}
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-4 flex justify-end">
            <Dialog open={isAddDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <PlusCircle className="mr-2 h-4 w-4" />
                  Add Question
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Question</DialogTitle>
                </DialogHeader>
                <QuestionForm
                  form={addForm}
                  onSubmit={handleAddQuestion}
                  isLoading={isSubmitting}
                  submitButtonText="Add Question"
                />
              </DialogContent>
            </Dialog>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={!!questionToEdit} onOpenChange={(isOpen) => !isOpen && setQuestionToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
          </DialogHeader>
          <QuestionForm
            form={editForm}
            onSubmit={handleUpdateQuestion}
            isLoading={isSubmitting}
            submitButtonText="Save Changes"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
