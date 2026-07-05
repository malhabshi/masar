'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Student, ChecklistConfigItem } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { updateChecklistItem, getChecklistConfig } from '@/lib/actions';
import { Progress } from '@/components/ui/progress';

interface ReadinessChecklistProps {
  student: Student;
  currentUser: AppUser;
}

export function ReadinessChecklist({ student, currentUser }: ReadinessChecklistProps) {
  const { toast } = useToast();
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());
  const [configItems, setConfigItems] = useState<ChecklistConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(true);

  useEffect(() => {
    getChecklistConfig().then(items => {
      setConfigItems(items);
      setConfigLoading(false);
    });
  }, []);

  const canManage = currentUser.civilId === student.employeeId
    || ['admin', 'adminplus'].includes(currentUser.role);
  const status: Record<string, boolean> = student.profileCompletionStatus || {};

  const regularItems = useMemo(() => configItems.filter(i => !i.isFinal), [configItems]);
  const finalItem = useMemo(() => configItems.find(i => i.isFinal) ?? null, [configItems]);

  const allRegularChecked = useMemo(
    () => regularItems.every(item => !!status[item.id]),
    [regularItems, status]
  );

  const handleToggle = async (itemId: string, label: string, isFinalItem: boolean, currentValue: boolean) => {
    if (!canManage) return;

    if (isFinalItem && !allRegularChecked) {
      toast({
        variant: 'destructive',
        title: 'Action Not Allowed',
        description: `All other checklist items must be completed before marking "${label}".`,
      });
      return;
    }

    setUpdatingItems(prev => new Set(prev).add(itemId));
    const result = await updateChecklistItem(student.id, itemId, !currentValue, currentUser.id);

    if (result.success) {
      toast({ title: 'Checklist Updated', description: `"${label}" status has been updated.` });
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }

    setUpdatingItems(prev => {
      const next = new Set(prev);
      next.delete(itemId);
      return next;
    });
  };

  const completedCount = regularItems.filter(item => status[item.id]).length;
  const totalCount = regularItems.length;
  const progressPercentage = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Readiness Checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {configLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-sm text-muted-foreground mb-1">
                <span>Progress</span>
                <span>{completedCount} / {totalCount}</span>
              </div>
              <Progress value={progressPercentage} />
            </div>

            <div className="space-y-3">
              {regularItems.map(item => {
                const isChecked = !!status[item.id];
                const isUpdating = updatingItems.has(item.id);
                return (
                  <div key={item.id} className="flex items-center space-x-3 rounded-md p-2 hover:bg-muted/50">
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Checkbox
                        id={item.id}
                        checked={isChecked}
                        disabled={!canManage || isUpdating}
                        onCheckedChange={() => handleToggle(item.id, item.label, false, isChecked)}
                      />
                    )}
                    <Label
                      htmlFor={item.id}
                      className={`flex-1 ${!canManage ? 'cursor-default' : 'cursor-pointer'}`}
                    >
                      {item.label}
                    </Label>
                  </div>
                );
              })}
            </div>

            {finalItem && (
              <div className="border-t pt-4 mt-4 flex items-center space-x-3 rounded-md p-2 bg-muted/30">
                <Checkbox
                  id={finalItem.id}
                  checked={!!status[finalItem.id]}
                  disabled={!canManage || !allRegularChecked || updatingItems.has(finalItem.id)}
                  onCheckedChange={() => handleToggle(finalItem.id, finalItem.label, true, !!status[finalItem.id])}
                  title={!allRegularChecked ? 'Complete all other items to enable' : ''}
                />
                <Label
                  htmlFor={finalItem.id}
                  className={`font-bold text-lg ${!allRegularChecked || !canManage ? 'text-muted-foreground cursor-not-allowed' : 'text-success cursor-pointer'}`}
                >
                  {finalItem.label}
                </Label>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
