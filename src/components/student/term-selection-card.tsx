'use client';

import { useState, useMemo } from 'react';
import type { Student, AcademicTerm } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { updateStudentTerm, addAcademicTerm } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { sortByDate } from '@/lib/timestamp-utils';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator } from '@/components/ui/select';
import { Calendar, Loader2, CheckCircle2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogClose
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

  // Fetch the global list of terms.
  const { data: terms, isLoading: termsLoading } = useCollection<AcademicTerm>('academic_terms');

  const isAdmin = currentUser.role === 'admin';
  const canManage = isAdmin || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

  // Memoize sorted terms
  const sortedTerms = useMemo(() => {
    if (!terms || terms.length === 0) return [];
    return [...terms].sort((a, b) => sortByDate(a, b, 'createdAt', 'desc'));
  }, [terms]);

  const handleTermChange = async (newTerm: string) => {
    // If admin picks the special "Add New" option
    if (newTerm === '___ADD_NEW_TERM___') {
      setIsDialogOpen(true);
      return;
    }

    if (!canManage) return;
    
    setIsUpdating(true);
    const result = await updateStudentTerm(student.id, newTerm, currentUser.id);
    
    if (result.success) {
      toast({ 
        title: 'Term Updated', 
        description: `Student intake set to ${newTerm}.` 
      });
    } else {
      toast({ 
        variant: 'destructive', 
        title: 'Update Failed', 
        description: result.message 
      });
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
      console.error("Failed to quick-add term:", err);
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
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <Select 
              key={sortedTerms.length + (student.term || 'none')} 
              value={student.term || 'none'} 
              onValueChange={handleTermChange}
              disabled={!canManage || isUpdating || termsLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={termsLoading ? "Loading terms..." : "Select Intake Term"} />
              </SelectTrigger>
              <SelectContent>
                {termsLoading ? (
                  <div className="flex items-center justify-center p-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    {sortedTerms.length > 0 ? (
                      <>
                        <SelectItem value="none" disabled>Select an option...</SelectItem>
                        {sortedTerms.map((term) => (
                          <SelectItem key={term.id} value={term.name}>
                            {term.name}
                          </SelectItem>
                        ))}
                      </>
                    ) : (
                      <div className="p-2 text-sm text-muted-foreground text-center">
                        No terms available. Ask admin to create options.
                      </div>
                    )}

                    {isAdmin && (
                      <>
                        <SelectSeparator />
                        <SelectItem 
                          value="___ADD_NEW_TERM___" 
                          className="text-primary font-semibold focus:bg-primary/10 cursor-pointer"
                        >
                          <div className="flex items-center gap-2">
                            <Plus className="h-4 w-4" />
                            Add New Intake...
                          </div>
                        </SelectItem>
                      </>
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
        {!canManage && (
          <p className="text-xs text-muted-foreground mt-2 italic">
            Only the assigned employee or an admin can change this.
          </p>
        )}
      </CardContent>

      {/* Quick Add Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New Intake Term</DialogTitle>
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
              Create Global Option
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
