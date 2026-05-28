'use client';

import { useState, useEffect } from 'react';
import type { Student, ChecklistConfigItem } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck } from 'lucide-react';
import { getAdminChecklistConfig, updateAdminChecklistItem } from '@/lib/actions';

interface AdminChecklistProps {
  student: Student;
  currentUser: AppUser;
}

export function AdminChecklist({ student, currentUser }: AdminChecklistProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<ChecklistConfigItem[]>([]);
  const [configLoading, setConfigLoading] = useState(true);
  const [updatingItems, setUpdatingItems] = useState<Set<string>>(new Set());

  useEffect(() => {
    getAdminChecklistConfig().then(loaded => {
      setItems(loaded);
      setConfigLoading(false);
    });
  }, []);

  // Only render for Foundation students
  if (student.studyLevel !== 'Foundation') return null;

  const canEdit = ['admin', 'adminplus', 'department'].includes(currentUser.role);
  const status: Record<string, boolean> = student.adminChecklistStatus || {};

  const checkedCount = items.filter(i => !!status[i.id]).length;

  const handleToggle = async (item: ChecklistConfigItem, currentValue: boolean) => {
    if (!canEdit) return;
    setUpdatingItems(prev => new Set(prev).add(item.id));
    const result = await updateAdminChecklistItem(student.id, item.id, !currentValue, currentUser.id);
    if (result.success) {
      toast({ title: 'Checklist Updated', description: `"${item.label}" has been updated.` });
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setUpdatingItems(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  if (configLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-24">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            <CardTitle>Admin Checklist</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {checkedCount} / {items.length}
            </Badge>
            {!canEdit && (
              <Badge variant="secondary" className="text-xs">Read Only</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map(item => {
            const isChecked = !!status[item.id];
            const isUpdating = updatingItems.has(item.id);
            return (
              <div key={item.id} className="flex items-center space-x-3 rounded-md p-2 hover:bg-muted/50">
                {isUpdating ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <Checkbox
                    id={`admin-cl-${item.id}`}
                    checked={isChecked}
                    disabled={!canEdit || isUpdating}
                    onCheckedChange={() => handleToggle(item, isChecked)}
                  />
                )}
                <Label
                  htmlFor={`admin-cl-${item.id}`}
                  className={`flex-1 ${!canEdit ? 'cursor-default' : 'cursor-pointer'} ${isChecked ? 'line-through text-muted-foreground' : ''}`}
                >
                  {item.label}
                </Label>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
