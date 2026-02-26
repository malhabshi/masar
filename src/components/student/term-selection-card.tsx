
'use client';

import { useState } from 'react';
import type { Student, AcademicTerm } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { updateStudentTerm } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Loader2, CheckCircle2 } from 'lucide-react';

interface TermSelectionCardProps {
  student: Student;
  currentUser: AppUser;
}

export function TermSelectionCard({ student, currentUser }: TermSelectionCardProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  const { data: terms, isLoading: termsLoading } = useCollection<AcademicTerm>('academic_terms');

  const canManage = currentUser.role === 'admin' || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

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

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Academic Intake</CardTitle>
        </div>
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
                    No terms available. Ask admin to create options.
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
