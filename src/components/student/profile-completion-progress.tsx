
'use client';

import type { Student, ProfileCompletionStatus, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useMemo, useState, useTransition } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { updateProfileCompletionTask } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface ProfileCompletionProgressProps {
  student: Student;
  currentUser: User;
}

const completionTasks: { id: keyof ProfileCompletionStatus; label: string }[] = [
  { id: 'submitUniversityApplication', label: 'Submit an University Application' },
  { id: 'applyMoheScholarship', label: 'Apply for MOHE Scholarship' },
  { id: 'submitKcoRequest', label: 'Submit an KCO Request' },
  { id: 'receivedCasOrI20', label: 'Received the CAS / I-20' },
  { id: 'appliedForVisa', label: 'Applied for visa' },
  { id: 'documentsSubmittedToMohe', label: 'All document are submitted to Mohe' },
  { id: 'readyToTravel', label: 'Ready to travel' },
];

export function ProfileCompletionProgress({ student, currentUser }: ProfileCompletionProgressProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [isPending, startTransition] = useTransition();
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);

  const canEdit = currentUser?.civilId === student.employeeId;

  const { progress, completedCount, isReadyToTravel, allOtherTasksCompleted } = useMemo(() => {
    const status = student.profileCompletionStatus;
    if (!status) return { progress: 0, completedCount: 0, isReadyToTravel: false, allOtherTasksCompleted: false };
    
    const completedValues = Object.values(status);
    const completed = completedValues.filter(Boolean);

    const otherTasks = completionTasks.filter(t => t.id !== 'readyToTravel');
    const allOthersDone = otherTasks.every(t => status[t.id]);

    const progressValue = (completed.length / completionTasks.length) * 100;
    const ready = !!status.readyToTravel;
    return { 
        progress: progressValue, 
        completedCount: completed.length, 
        isReadyToTravel: ready,
        allOtherTasksCompleted: allOthersDone
    };
  }, [student.profileCompletionStatus]);
  
  const handleTaskToggle = (taskId: keyof ProfileCompletionStatus, checked: boolean) => {
    if (!canEdit || !firestore) return;

    setUpdatingTaskId(taskId);
    startTransition(async () => {
      // Simulate server action for pending state
      await updateProfileCompletionTask(student.id, taskId, checked);
      
      const newStatus = {
        ...(student.profileCompletionStatus || {}),
        [taskId]: checked,
      };

      const studentDocRef = doc(firestore, 'students', student.id);
      updateDocumentNonBlocking(studentDocRef, { profileCompletionStatus: newStatus as ProfileCompletionStatus });
      
      const taskLabel = completionTasks.find(t => t.id === taskId)?.label;

      toast({
        title: 'Progress Autosaved',
        description: `'${taskLabel || 'Task'}' has been marked as ${checked ? 'complete' : 'incomplete'}.`,
      });
      
      setUpdatingTaskId(null);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile Completion</CardTitle>
        <CardDescription>
          {completedCount} of {completionTasks.length} key tasks are complete. The 'Ready to travel' step unlocks after all others are done.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Progress 
          value={progress} 
          className="w-full mb-4" 
          indicatorClassName={cn({ 'bg-success': isReadyToTravel })} 
        />
        <div className="space-y-3">
          {completionTasks.map(task => {
            const isCompleted = student.profileCompletionStatus?.[task.id] ?? false;
            const isUpdating = isPending && updatingTaskId === task.id;
            const isReadyToTravelTask = task.id === 'readyToTravel';
            const isDisabled = !canEdit || isPending || (isReadyToTravelTask && !allOtherTasksCompleted && !isCompleted);

            return (
              <div key={task.id} className="flex items-center space-x-3 p-2 rounded-md transition-colors hover:bg-muted/50">
                {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                    <Checkbox
                        id={`task-${task.id}`}
                        checked={isCompleted}
                        onCheckedChange={(checked) => handleTaskToggle(task.id, !!checked)}
                        disabled={isDisabled}
                    />
                )}
                <label
                  htmlFor={`task-${task.id}`}
                  className={cn(
                    "text-sm font-medium leading-none",
                    isCompleted && "line-through text-muted-foreground",
                    !canEdit ? "cursor-not-allowed" : "cursor-pointer",
                    (isPending && !isUpdating) && "opacity-50 cursor-not-allowed",
                    isDisabled && !isCompleted && "cursor-not-allowed opacity-60"
                  )}
                >
                  {task.label}
                </label>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
