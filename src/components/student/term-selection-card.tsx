'use client';

import { useState } from 'react';
import type { Student, AcademicTerm } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { updateStudentTerm, addAcademicTerm } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Loader2, CheckCircle2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger, 
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

  const { data: terms, isLoading: termsLoading } = useCollection<AcademicTerm>('academic_terms');

  const isAdmin = currentUser.role === 'admin';
  const canManage = isAdmin || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

  const handleTermChange = async (newTerm: string) => {
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
    if (!newTermName.trim()) return;
    setIsAdding(true);
    const result = await addAcademicTerm(newTermName.trim(), currentUser.id);
    if (result.success) {
      toast({ title: 'Term Created', description: result.message });
      setNewTermName('');
      setIsDialogOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsAdding(false);
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
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-primary/10">
                <Plus className="h-4 w-4" />
                <span className="sr-only">Add intake option</span>
              </Button>
            </DialogTrigger>
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
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickAddTerm()}
                  />
                </div>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Cancel</Button>
                </DialogClose>
                <Button onClick={handleQuickAddTerm} disabled={isAdding || !newTermName.trim()}>
                  {isAdding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Add Option
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
              value={student.term || ''} 
              onValueChange={handleTermChange}
              disabled={!canManage || isUpdating || termsLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={termsLoading ? "Loading terms..." : "Select Intake Term"} />
              </SelectTrigger>
              <SelectContent>
                {terms && terms.length > 0 ? (
                  terms.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((term) => (
                    <SelectItem key={term.id} value={term.name}>
                      {term.name}
                    </SelectItem>
                  ))
                ) : (
                  <div className="p-2 text-sm text-muted-foreground text-center">
                    No terms available. Ask any of the admin users to create options.
                  </div>
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
    </Card>
  );
}
