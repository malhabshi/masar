'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { customizeApplicationQuestions } from '@/ai/flows/customize-application-questions';
import { applicationQuestions as initialQuestions } from '@/lib/data';
import { Wand2, Check, Copy, Loader2, Pencil, Trash2, PlusCircle } from 'lucide-react';
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

export function CustomizeQuestionsForm() {
  const [existingQuestions, setExistingQuestions] = useState<string[]>(initialQuestions);
  const [newRequirements, setNewRequirements] = useState('');
  const [updatedQuestions, setUpdatedQuestions] = useState<string[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  // New state for CRUD
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

  const handleGenerate = async () => {
    if (!newRequirements.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Please provide new requirements.',
      });
      return;
    }
    setIsLoading(true);
    setUpdatedQuestions(null);
    try {
      const result = await customizeApplicationQuestions({
        existingQuestions,
        newRequirements,
      });
      setUpdatedQuestions(result.updatedQuestions);
    } catch (error) {
      console.error(error);
      toast({
        variant: 'destructive',
        title: 'AI Generation Failed',
        description: 'Could not generate updated questions. Please try again.',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (!updatedQuestions) return;
    navigator.clipboard.writeText(updatedQuestions.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleApplyChanges = () => {
    if (!updatedQuestions) return;
    setExistingQuestions(updatedQuestions);
    setUpdatedQuestions(null);
    setNewRequirements('');
    toast({
      title: 'Changes Applied!',
      description: 'The application questions have been updated.',
    });
  };

  return (
    <>
      <div className="grid md:grid-cols-2 gap-8 max-w-6xl mx-auto">
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

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Customize with AI</CardTitle>
              <CardDescription>
                Alternatively, describe the changes you want to make, and AI will generate a new set of questions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="e.g., We need to add questions about visa status and financial sponsorship..."
                value={newRequirements}
                onChange={(e) => setNewRequirements(e.target.value)}
                className="min-h-[100px]"
              />
            </CardContent>
            <CardFooter>
              <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
                {isLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                Generate Updated Questions
              </Button>
            </CardFooter>
          </Card>

          {(isLoading || updatedQuestions) && (
            <Card>
              <CardHeader>
                <CardTitle>AI Generated Questions</CardTitle>
                <CardDescription>Review the questions generated by the AI. You can copy them or apply them to the form.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    <div className="h-4 bg-muted rounded-full w-3/4 animate-pulse"></div>
                    <div className="h-4 bg-muted rounded-full w-full animate-pulse"></div>
                    <div className="h-4 bg-muted rounded-full w-1/2 animate-pulse"></div>
                  </div>
                ) : updatedQuestions && (
                  <ul className="space-y-2 text-sm list-decimal list-inside">
                    {updatedQuestions.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
              <CardFooter className="flex justify-end gap-2">
                <Button variant="outline" onClick={handleCopyToClipboard} disabled={!updatedQuestions}>
                  {copied ? <Check className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy'}
                </Button>
                <Button onClick={handleApplyChanges} disabled={!updatedQuestions}>
                  Apply Changes
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
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
