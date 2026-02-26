'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Student, AcademicTerm } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { updateStudentTerm, addAcademicTerm } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { sortByDate } from '@/lib/timestamp-utils';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Loader2, CheckCircle2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogClose,
  DialogTrigger,
  DialogDescription
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface TermSelectionCardProps {
  student: Student;
  currentUser: AppUser;
}

export function TermSelectionCard({ student, currentUser }: TermSelectionCardProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newTermName, setNewTermName] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Real-time listener for global intake terms
  const { data: rawTerms, isLoading: termsLoading } = useCollection<AcademicTerm>('academic_terms');

  const isAdmin = currentUser.role === 'admin';
  const canManage = isAdmin || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

  // Memoize sorted terms (newest first)
  const sortedTerms = useMemo(() => {
    if (!rawTerms || rawTerms.length === 0) return [];
    console.log('[TermSelectionCard] Terms updated:', rawTerms.length);
    return [...rawTerms].sort((a, b) => sortByDate(a, b, 'createdAt', 'desc'));
  }, [rawTerms]);

  // Log terms presence for debugging
  useEffect(() => {
    if (rawTerms.length > 0) {
      console.log('[TermSelectionCard] Current term options available:', sortedTerms.map(t => t.name));
    }
  }, [sortedTerms, rawTerms.length]);

  const handleTermChange = async (newTerm: string) => {
    if (!canManage || newTerm === 'none' || newTerm === 'loading') return;
    
    setIsUpdating(true);
    const result = await updateStudentTerm(student.id, newTerm, currentUser.id);
    
    if (result.success) {
      toast({ title: 'Term Updated', description: `Student intake set to ${newTerm}.` });
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsUpdating(false);
  };

  const handleQuickAddTerm = async () => {
    const termName = newTermName.trim();
    if (!termName) return;
    
    setIsAdding(true);
    try {
      const result = await addAcademicTerm(termName, currentUser.id);
      if (result.success) {
        toast({ title: 'Term Created', description: result.message });
        setNewTermName('');
        setIsDialogOpen(false);
      } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
      }
    } catch (err) {
      console.error("[TermSelectionCard] Error adding term:", err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to create term.' });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-4 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Academic Intake</CardTitle>
        </div>
        {isAdmin && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary hover:text-primary hover:bg-primary/10">
                <PlusCircle className="h-5 w-5" />
                <span className="sr-only">Add New Intake</span>
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Global Intake Option</DialogTitle>
                <DialogDescription>
                  This term will become available for all students across the system.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="quick-term-name">Term Name</Label>
                  <Input 
                    id="quick-term-name" 
                    placeholder="e.g. 7/8 2026, Spring 2026" 
                    value={newTermName}
                    onChange={(e) => setNewTermName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleQuickAddTerm();
                      }
                    }}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleQuickAddTerm} disabled={isAdding || !newTermName.trim()}>
                  {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Term
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Select 
              key={`${sortedTerms.length}-${student.term || 'none'}`}
              value={student.term || 'none'} 
              onValueChange={handleTermChange}
              disabled={!canManage || isUpdating || termsLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={termsLoading ? "Syncing..." : "Select Intake Term"} />
              </SelectTrigger>
              <SelectContent>
                {termsLoading ? (
                  <SelectItem value="loading" disabled>
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Syncing terms...</span>
                    </div>
                  </SelectItem>
                ) : (
                  <>
                    <SelectItem value="none" disabled>Select an intake...</SelectItem>
                    {sortedTerms.map((term) => (
                      <SelectItem key={term.id} value={term.name}>
                        {term.name}
                      </SelectItem>
                    ))}
                    
                    {sortedTerms.length === 0 && (
                      <SelectItem value="no-data" disabled>
                        No terms available. contact any admin user.
                      </SelectItem>
                    )}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {isUpdating ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
          ) : student.term ? (
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
