
'use client';

import { useState, useMemo } from 'react';
import type { Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { updateStudentTerm } from '@/lib/actions';
import { CalendarDays, Loader2 } from 'lucide-react';
import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

interface StudentTermSelectorProps {
  student: Student;
  currentUser: User;
}

const ADD_NEW_TERM_VALUE = '__add_new__';

export function StudentTermSelector({ student, currentUser }: StudentTermSelectorProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  
  const termsCollection = useMemo(() => !firestore ? null : collection(firestore, 'academic_terms'), [firestore]);
  const { data: termsData } = useCollection(termsCollection);
  const terms = useMemo(() => termsData?.map(t => t.name).sort() || [], [termsData]);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);

  const canSelectTerm = currentUser.role === 'admin' || currentUser.civilId === student.employeeId;
  const canAddTerm = currentUser.role === 'admin';

  const handleTermChange = async (selectedTerm: string) => {
    if (!firestore) return;
    if (selectedTerm === ADD_NEW_TERM_VALUE) {
      if (canAddTerm) {
        setIsDialogOpen(true);
      }
      return;
    }
    
    setIsUpdating(true);
    const studentDocRef = doc(firestore, 'students', student.id);
    const previousTerm = student.term;
    // Optimistic update
    updateDocumentNonBlocking(studentDocRef, { term: selectedTerm });

    // Server action
    const result = await updateStudentTerm(student.id, student.name, selectedTerm, currentUser.id);
    if (result.success) {
      toast({ title: 'Term Updated', description: result.message });
    } else {
      // Revert on failure
      updateDocumentNonBlocking(studentDocRef, { term: previousTerm });
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsUpdating(false);
  };
  
  const handleAddNewTerm = async () => {
    if (!newTerm.trim() || !firestore || !termsCollection) {
      toast({ variant: 'destructive', title: 'Term cannot be empty' });
      return;
    }
    const formattedTerm = newTerm.trim();
    addDocumentNonBlocking(termsCollection, { name: formattedTerm });
    
    setIsDialogOpen(false);
    setNewTerm('');
    // Now set this new term for the student
    await handleTermChange(formattedTerm);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Academic Term</CardTitle>
        </CardHeader>
        <CardContent>
          {isUpdating ? (
            <div className="flex items-center justify-center h-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Select onValueChange={handleTermChange} value={student.term || ''} disabled={!canSelectTerm}>
              <SelectTrigger>
                <SelectValue placeholder="Select a term..." />
              </SelectTrigger>
              <SelectContent>
                {terms.map((term) => (
                  <SelectItem key={term} value={term}>
                    {term}
                  </SelectItem>
                ))}
                {canAddTerm && (
                  <SelectItem value={ADD_NEW_TERM_VALUE}>
                    <div className="flex items-center gap-2 text-primary">
                      <CalendarDays className="h-4 w-4" />
                      <span>Add new term...</span>
                    </div>
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>
      
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Academic Term</DialogTitle>
            <DialogDescription>
              Enter the new term and year. This will be added to the list for everyone.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input 
              placeholder="e.g., Summer 2026"
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleAddNewTerm}>Add and Select Term</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
