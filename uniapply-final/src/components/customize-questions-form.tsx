'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { applicationQuestions as initialQuestions } from '@/lib/data';
import { Pencil, Trash2, PlusCircle } from 'lucide-react';
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
  const [existingQuestions, setExistingQuestions] = useState<string[]>(initialQuestions);
  const { toast } = useToast();

  const [newQuestion, setNewQuestion] = useState('');
  const [questionToEdit, setQuestionToEdit] = useState<{ index: number; text: string } | null>(null);
  const [editedQuestionText, setEditedQuestionText] = useState('');

  const handleAddQuestion = () => {
    if (!newQuestion.trim()) return;
    setExistingQuestions(prev => [...prev, newQuestion.trim()]);
    setNewQuestion('');
    toast({ title: 'Question Added' });
  };

  const handleUpdateQuestion = () => {
    if (!questionToEdit || !editedQuestionText.trim()) return;
    const updated = [...existingQuestions];
    updated[questionToEdit.index] = editedQuestionText.trim();
    setExistingQuestions(updated);
    setQuestionToEdit(null);
    setEditedQuestionText('');
    toast({ title: 'Question Updated' });
  };

  const handleDeleteQuestion = (indexToDelete: number) => {
    setExistingQuestions(prev => prev.filter((_, i) => i !== indexToDelete));
    toast({ title: 'Question Removed' });
  };

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
              {existingQuestions.length > 0 ? (
                existingQuestions.map((q, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-md group hover:bg-muted/50">
                    <span className="flex-1 pr-4">{i + 1}. {q}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                        setQuestionToEdit({ index: i, text: q });
                        setEditedQuestionText(q);
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
                            <AlertDialogAction onClick={() => handleDeleteQuestion(i)}>Delete</AlertDialogAction>
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
