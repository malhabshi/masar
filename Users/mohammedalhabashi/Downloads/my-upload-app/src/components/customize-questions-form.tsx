'use client';

import { useState, useMemo } from 'react';
import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { ApplicationQuestion } from '@/lib/types';
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

export function CustomizeQuestionsForm() {
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const questionsCollection = useMemo(() => {
    if (!firestore) return null;
    return collection(firestore, 'application_questions');
  }, [firestore]);

  const { data: questions, isLoading } = useCollection<ApplicationQuestion>(questionsCollection);

  const sortedQuestions = useMemo(() => {
    if (!questions) return [];
    return [...questions].sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  }, [questions]);

  const [newQuestion, setNewQuestion] = useState('');
  const [questionToEdit, setQuestionToEdit] = useState<ApplicationQuestion | null>(null);
  const [editedQuestionText, setEditedQuestionText] = useState('');

  const handleAddQuestion = () => {
    if (!newQuestion.trim() || !questionsCollection) return;
    const newQuestionData: Omit<ApplicationQuestion, 'id'> = {
      questionText: newQuestion.trim(),
      questionType: 'text',
      isRequired: true,
      isActive: true,
      sortOrder: questions?.length || 0,
      createdAt: new Date().toISOString(),
    };
    addDocumentNonBlocking(questionsCollection, newQuestionData);
    setNewQuestion('');
    toast({ title: 'Question Added' });
  };

  const handleUpdateQuestion = () => {
    if (!questionToEdit || !editedQuestionText.trim() || !firestore) return;
    const questionDocRef = doc(firestore, 'application_questions', questionToEdit.id);
    updateDocumentNonBlocking(questionDocRef, { questionText: editedQuestionText.trim() });
    setQuestionToEdit(null);
    setEditedQuestionText('');
    toast({ title: 'Question Updated' });
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (!firestore) return;
    const questionDocRef = doc(firestore, 'application_questions', questionId);
    deleteDocumentNonBlocking(questionDocRef);
    toast({ title: 'Question Removed' });
  };

  if (isLoading) {
    return (
        <Card className="max-w-3xl mx-auto">
            <CardHeader>
                <CardTitle>Application Questions</CardTitle>
                <CardDescription>Loading questions...</CardDescription>
            </CardHeader>
            <CardContent>
                <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
            </CardContent>
        </Card>
    );
  }

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
            <div className="space-y-2">
              {sortedQuestions.length > 0 ? (
                sortedQuestions.map((q, i) => (
                  <div key={q.id} className="flex items-center justify-between p-2 rounded-md group hover:bg-muted/50">
                    <span className="flex-1 pr-4">{i + 1}. {q.questionText}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setQuestionToEdit(q);
                        setEditedQuestionText(q.questionText);
                      }}>
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
                ))
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No questions have been added yet.</p>
              )}
            </div>
          </CardContent>
          <CardFooter className="border-t pt-4">
            <div className="flex w-full items-center space-x-2">
              <Input
                placeholder="Add a new question..."
                value={newQuestion}
                onChange={(e) => setNewQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddQuestion() }}
              />
              <Button onClick={handleAddQuestion} disabled={!newQuestion.trim()}>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={!!questionToEdit} onOpenChange={(isOpen) => !isOpen && setQuestionToEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Question</DialogTitle>
            <DialogDescription>
              Make changes to the question below.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea
              value={editedQuestionText}
              onChange={(e) => setEditedQuestionText(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuestionToEdit(null)}>Cancel</Button>
            <Button onClick={handleUpdateQuestion}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
