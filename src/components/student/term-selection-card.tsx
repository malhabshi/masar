'use client';

import { useState, useMemo } from 'react';
import type { Student, AcademicTerm } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { updateStudentTerm, addAcademicTerm, seedAcademicTerms } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Loader2 } from 'lucide-react';
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
import { Separator } from '@/components/ui/separator';

export function TermSelectionCard({ student, currentUser }: { student: Student; currentUser: AppUser }) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const [newTermName, setNewTermName] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Fetch all global intake terms in real-time
  const { data: terms, isLoading: termsLoading } = useCollection<AcademicTerm>('academic_terms');

  const isAdmin = currentUser.role === 'admin';
  const canManage = isAdmin || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

  // Memoize sorted terms (newest first based on creation date)
  const sortedTerms = useMemo(() => {
    if (!terms) return [];
    return [...terms].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }, [terms]);

  const handleTermChange = async (value: string) => {
    if (value === 'ADD_NEW') {
      setIsDialogOpen(true);
      return;
    }
    
    if (value === 'SEED_DEFAULTS') {
      setIsSeeding(true);
      const res = await seedAcademicTerms(currentUser.id);
      if (res.success) {
        toast({ title: 'Terms Seeded', description: res.message });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: res.message });
      }
      setIsSeeding(false);
      return;
    }

    if (!canManage || value === 'none') return;
    
    setIsUpdating(true);
    const result = await updateStudentTerm(student.id, value, currentUser.id);
    
    if (result.success) {
      toast({ title: 'Success', description: 'Student intake term updated.' });
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsUpdating(false);
  };

  const handleQuickAddTerm = async () => {
    const name = newTermName.trim();
    if (!name) return;
    
    setIsAdding(true);
    const result = await addAcademicTerm(name, currentUser.id);
    if (result.success) {
      toast({ title: 'Term Added', description: result.message });
      setNewTermName('');
      setIsDialogOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsAdding(false);
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Academic Intake</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Select 
            key={`term-select-${sortedTerms.length}-${student.term || 'none'}`}
            value={student.term || 'none'} 
            onValueChange={handleTermChange}
            disabled={!canManage || isUpdating || termsLoading || isSeeding}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={termsLoading ? "Syncing..." : "Select Intake Term"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" disabled>Choose an intake...</SelectItem>
              
              {sortedTerms.map((term) => (
                <SelectItem key={term.id} value={term.name}>
                  {term.name}
                </SelectItem>
              ))}

              {isAdmin && (
                <>
                  <Separator className="my-2" />
                  <SelectItem value="ADD_NEW" className="text-primary font-bold cursor-pointer">
                    + Add Custom Intake Option...
                  </SelectItem>
                  <SelectItem value="SEED_DEFAULTS" className="text-blue-600 font-bold cursor-pointer">
                    Restore Default Intake Options
                  </SelectItem>
                </>
              )}
            </SelectContent>
          </Select>
          {(isUpdating || isSeeding) && (
            <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
          )}
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Global Intake</DialogTitle>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="quick-term-name">Term Name</Label>
                <Input 
                  id="quick-term-name" 
                  placeholder="e.g. Summer 2026 (6/7)" 
                  value={newTermName}
                  onChange={(e) => setNewTermName(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button onClick={handleQuickAddTerm} disabled={isAdding || !newTermName.trim()}>
                {isAdding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Save Intake Option'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
