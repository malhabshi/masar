'use client';

import { useState } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { updateDocumentNonBlocking } from '@/firebase/client';

interface JotformCardProps {
  student: Student;
  currentUser: AppUser;
}

export function JotformCard({ student, currentUser }: JotformCardProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  // Editable by assigned employee or admins/departments
  const canManage = currentUser.role === 'admin' || currentUser.role === 'department' || currentUser.civilId === student.employeeId;

  const handleToggle = async (currentValue: boolean) => {
    if (!canManage) return;

    setIsUpdating(true);
    try {
      const studentRef = doc(firestore, 'students', student.id);
      await updateDocumentNonBlocking(studentRef, { jotform: !currentValue });
      
      toast({
        title: 'Jotform Status Updated',
        description: `Jotform was marked as ${!currentValue ? 'completed' : 'pending'}.`,
      });
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'Could not update Jotform status',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const isChecked = !!student.jotform;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Jotform Data</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center space-x-3 rounded-md p-2 hover:bg-muted/50 transition-colors">
          {isUpdating ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (
            <Checkbox
              id="jotform-status"
              checked={isChecked}
              disabled={!canManage || isUpdating}
              onCheckedChange={() => handleToggle(isChecked)}
            />
          )}
          <Label
            htmlFor="jotform-status"
            className={`flex-1 ${!canManage ? 'cursor-default' : 'cursor-pointer'} font-medium`}
          >
            {isChecked ? 'Jotform Completed' : 'Pending Jotform'}
          </Label>
        </div>
      </CardContent>
    </Card>
  );
}
