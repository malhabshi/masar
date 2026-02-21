'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useFirebase, useCollection, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { Question } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Trash2, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import React from 'react';

const questionSchema = z.object({
  label: z.string().min(3, 'Question text must be at least 3 characters.'),
  type: z.enum(['text', 'textarea', 'select', 'radio', 'checkbox']),
  options: z.string().optional(),
  required: z.boolean().default(false),
  order: z.number().default(0),
});

function QuestionDialog({
  isOpen,
  setIsOpen,
  question,
  onSubmit,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  question?: Question;
  onSubmit: (values: z.infer<typeof questionSchema>) => void;
}) {
  const form = useForm<z.infer<typeof questionSchema>>({
    resolver: zodResolver(questionSchema),
    defaultValues: question || {
      label: '',
      type: 'text',
      options: '',
      required: false,
      order: 0,
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset(question || {
        label: '',
        type: 'text',
        options: '',
        required: false,
        order: 0,
      });
    }
  }, [isOpen, form, question]);

  const handleSubmit = (values: z.infer<typeof questionSchema>) => {
    onSubmit(values);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{question ? 'Edit' : 'Add'} Question</DialogTitle>
          <DialogDescription>
            Customize the questions that appear on the new student application form.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question Text</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Enter the question text..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question Type</FormLabel>
                  <FormControl>
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={field.value}
                      onChange={field.onChange}
                    >
                      <option value="text">Text (short answer)</option>
                      <option value="textarea">Textarea (long answer)</option>
                      <option value="select">Select (dropdown)</option>
                      <option value="radio">Radio (single choice)</option>
                      <option value="checkbox">Checkbox (multiple choice)</option>
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {['select', 'radio', 'checkbox'].includes(form.watch('type')) && (
              <FormField
                control={form.control}
                name="options"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Options (one per line)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="required"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <input
                      type="checkbox"
                      checked={field.value}
                      onChange={field.onChange}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                  </FormControl>
                  <FormLabel>Required field</FormLabel>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomizeQuestionsForm() {
  const { user: currentUser, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | undefined>(undefined);

  const questionsCollection = useMemo(() => {
    if (!firestore) return null;
    return collection(firestore, 'application_questions');
  }, [firestore]);

  const { data: questions, isLoading: questionsAreLoading } = useCollection<Question>(questionsCollection);
  
  const isLoading = isUserLoading || questionsAreLoading;

  const handleAddOrUpdateQuestion = (values: z.infer<typeof questionSchema>) => {
    if (!firestore || !questionsCollection) return;
    
    const questionData = {
      ...values,
      options: values.options ? values.options.split('\n').filter(Boolean) : [],
    };

    if (editingQuestion) {
      const docRef = doc(firestore, 'application_questions', editingQuestion.id);
      updateDocumentNonBlocking(docRef, questionData);
      toast({ title: 'Success', description: 'Question updated.' });
    } else {
      addDocumentNonBlocking(questionsCollection, questionData);
      toast({ title: 'Success', description: 'New question added.' });
    }
    setEditingQuestion(undefined);
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'application_questions', questionId);
    deleteDocumentNonBlocking(docRef);
    toast({ title: 'Success', description: 'Question deleted.' });
  };
  
  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (currentUser?.role !== 'admin') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to customize questions.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Customize Application Questions</CardTitle>
            <CardDescription>
              Add, edit, or remove questions from the new student application form.
            </CardDescription>
          </div>
          <Button onClick={() => { setEditingQuestion(undefined); setIsDialogOpen(true); }}>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Question
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {questions && questions.length > 0 ? (
              questions.sort((a, b) => (a.order || 0) - (b.order || 0)).map((q) => (
                <Card key={q.id}>
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{q.label}</CardTitle>
                        <CardDescription>
                          Type: {q.type} | Required: {q.required ? 'Yes' : 'No'}
                          {q.options && q.options.length > 0 && (
                            <> | Options: {q.options.join(', ')}</>
                          )}
                        </CardDescription>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingQuestion(q); setIsDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Question</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this question? This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteQuestion(q.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">No questions configured.</p>
            )}
          </div>
        </CardContent>
      </Card>
      <QuestionDialog
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        question={editingQuestion}
        onSubmit={handleAddOrUpdateQuestion}
      />
    </>
  );
}
