'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useUser } from '@/hooks/use-user';
import { firestore, useCollection, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase/client';
import { collection, doc } from 'firebase/firestore';
import type { ApplicationQuestion } from '@/lib/types';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';

// Update schema to match all possible question types
const questionSchema = z.object({
  questionText: z.string().min(3, 'Question text must be at least 3 characters.'),
  questionType: z.enum(['text', 'textarea', 'number', 'date', 'select', 'checkbox']),
  options: z.string().optional(),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().default(0),
});

function QuestionDialog({
  isOpen,
  setIsOpen,
  question,
  onSubmit,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  question?: ApplicationQuestion;
  onSubmit: (values: z.infer<typeof questionSchema>) => void;
}) {
  const form = useForm<z.infer<typeof questionSchema>>({
    resolver: zodResolver(questionSchema),
    defaultValues: {
      questionText: question?.questionText || '',
      questionType: question?.questionType || 'text',
      options: question?.options?.join('\n') || '',
      isRequired: question?.isRequired || false,
      isActive: question?.isActive ?? true,
      sortOrder: question?.sortOrder || 0,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        questionText: question?.questionText || '',
        questionType: question?.questionType || 'text',
        options: question?.options?.join('\n') || '',
        isRequired: question?.isRequired || false,
        isActive: question?.isActive ?? true,
        sortOrder: question?.sortOrder || 0,
      });
    }
  }, [isOpen, form, question]);

  const handleSubmit = (values: z.infer<typeof questionSchema>) => {
    onSubmit(values);
    setIsOpen(false);
  };

  const watchQuestionType = form.watch('questionType');

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
              name="questionText"
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
              name="questionType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Question Type</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select question type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="text">Text (short answer)</SelectItem>
                      <SelectItem value="textarea">Textarea (long answer)</SelectItem>
                      <SelectItem value="number">Number</SelectItem>
                      <SelectItem value="date">Date</SelectItem>
                      <SelectItem value="select">Select (dropdown)</SelectItem>
                      <SelectItem value="checkbox">Checkbox</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            {['select', 'checkbox'].includes(watchQuestionType) && (
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
              name="isRequired"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
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
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<ApplicationQuestion | undefined>(undefined);

  const questionsCollection = useMemoFirebase(() => collection(firestore, 'application_questions'), []);

  const { data: questions, isLoading: questionsAreLoading } = useCollection<ApplicationQuestion>(questionsCollection);
  
  const isLoading = isUserLoading || questionsAreLoading;

  const handleAddOrUpdateQuestion = (values: z.infer<typeof questionSchema>) => {
    if (!questionsCollection) return;
    
    const questionData = {
      questionText: values.questionText,
      questionType: values.questionType,
      options: values.options ? values.options.split('\n').filter(Boolean) : [],
      isRequired: values.isRequired,
      isActive: values.isActive,
      sortOrder: values.sortOrder,
      createdAt: editingQuestion ? editingQuestion.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
              questions.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((q) => (
                <Card key={q.id}>
                  <CardHeader className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{q.questionText}</CardTitle>
                        <CardDescription>
                          Type: {q.questionType} | Required: {q.isRequired ? 'Yes' : 'No'}
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
