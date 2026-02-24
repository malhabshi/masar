'use client';

import { useState, useMemo } from 'react';
import type { Student, ProfileCompletionStatus } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { updateChecklistItem } from '@/lib/actions';
import { Progress } from '@/components/ui/progress';

interface ReadinessChecklistProps {
  student: Student;
  currentUser: AppUser;
}

const checklistLabels: Record<keyof ProfileCompletionStatus, string> = {
  submitUniversityApplication: 'Submit University Application',
  applyMoheScholarship: 'Apply for MOHE Scholarship',
  submitKcoRequest: 'Submit KCO Request',
  receivedCasOrI20: 'Received CAS or I-20',
  appliedForVisa: 'Applied for Visa',
  visaGranted: 'Visa Granted',
  documentsSubmittedToMohe: 'Documents Submitted to MOHE',
  medicalFitnessSubmitted: 'Medical Fitness Submitted',
  financialStatementsProvided: 'Financial Statements Provided',
  readyToTravel: 'Ready to Travel',
};

// Exclude readyToTravel from the main list as it's the final status
const checklistKeys = Object.keys(checklistLabels).filter(key => key !== 'readyToTravel') as (keyof ProfileCompletionStatus)[];

export function ReadinessChecklist({ student, currentUser }: ReadinessChecklistProps) {
  const { toast } = useToast();
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());

  // Rule 1: Checklist is editable by the assigned employee.
  const canManage = currentUser.civilId === student.employeeId;
  
  const status: Partial<ProfileCompletionStatus> = student.profileCompletionStatus || {};

  // Rule 2: "Ready to Travel" is only enabled when all other items are checked.
  const allOtherItemsChecked = useMemo(() => {
      return checklistKeys.every(key => !!status[key]);
  }, [status]);


  const handleToggle = async (itemKey: keyof ProfileCompletionStatus, currentValue: boolean) => {
    if (!canManage) return;

    // Special check for 'readyToTravel'
    if (itemKey === 'readyToTravel' && !allOtherItemsChecked) {
        toast({
            variant: 'destructive',
            title: 'Action Not Allowed',
            description: 'All other checklist items must be completed before marking as "Ready to Travel".',
        });
        return;
    }

    setUpdatingItems(prev => new Set(prev).add(itemKey));

    const result = await updateChecklistItem(student.id, itemKey, !currentValue, currentUser.id);

    if (result.success) {
      toast({
        title: 'Checklist Updated',
        description: `"${checklistLabels[itemKey]}" status has been updated.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: result.message,
      });
    }

    setUpdatingItems(prev => {
      const newSet = new Set(prev);
      newSet.delete(itemKey);
      return newSet;
    });
  };
  
  const completedCount = checklistKeys.filter(key => status[key]).length;
  const totalCount = checklistKeys.length;
  const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;


  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness Checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <div className="flex justify-between text-sm text-muted-foreground mb-1">
            <span>Progress</span>
            <span>{completedCount} / {totalCount}</span>
          </div>
          <Progress value={progressPercentage} />
        </div>
        
        <div className="space-y-3">
          {checklistKeys.map(key => {
            const isChecked = !!status[key];
            const isUpdating = updatingItems.has(key);
            return (
              <div key={key} className="flex items-center space-x-3 rounded-md p-2 hover:bg-muted/50">
                {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Checkbox
                    id={key}
                    checked={isChecked}
                    disabled={!canManage || isUpdating}
                    onCheckedChange={() => handleToggle(key, isChecked)}
                    />
                )}
                <Label
                  htmlFor={key}
                  className={`flex-1 ${!canManage ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {checklistLabels[key]}
                </Label>
              </div>
            );
          })}
        </div>
        <div className="border-t pt-4 mt-4 flex items-center space-x-3 rounded-md p-2 bg-muted/30">
            <Checkbox
                id="readyToTravel"
                checked={!!status.readyToTravel}
                disabled={!canManage || !allOtherItemsChecked || updatingItems.has('readyToTravel')}
                onCheckedChange={() => handleToggle('readyToTravel', !!status.readyToTravel)}
                title={!allOtherItemsChecked ? "Complete all other items to enable" : ""}
            />
            <Label htmlFor="readyToTravel" className={`font-bold text-lg ${!allOtherItemsChecked || !canManage ? 'text-muted-foreground cursor-not-allowed' : 'text-success cursor-pointer'}`}>
                {checklistLabels.readyToTravel}
            </Label>
        </div>
      </CardContent>
    </Card>
  );
}
