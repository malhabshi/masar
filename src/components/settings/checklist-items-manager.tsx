'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle, Trash2, CheckSquare, ChevronUp, ChevronDown, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getChecklistConfig, saveChecklistConfig } from '@/lib/actions';
import { useUser } from '@/hooks/use-user';
import type { ChecklistConfigItem } from '@/lib/types';

export function ChecklistItemsManager() {
  const { toast } = useToast();
  const { user } = useUser();
  const [items, setItems] = useState<ChecklistConfigItem[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getChecklistConfig().then(saved => {
      setItems(saved);
      setIsLoading(false);
    });
  }, []);

  const handleAdd = () => {
    const label = newLabel.trim();
    if (!label) return;
    const id = `custom_${Date.now()}`;
    const order = items.length;
    setItems(prev => [...prev, { id, label, order }]);
    setNewLabel('');
  };

  const handleRemove = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id).map((item, idx) => ({ ...item, order: idx })));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setItems(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next.map((item, i) => ({ ...item, order: i }));
    });
  };

  const handleMoveDown = (idx: number) => {
    setItems(prev => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next.map((item, i) => ({ ...item, order: i }));
    });
  };

  const handleToggleFinal = (id: string) => {
    setItems(prev => prev.map(item => ({
      ...item,
      isFinal: item.id === id ? !item.isFinal : false,
    })));
  };

  const handleLabelEdit = (id: string, value: string) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, label: value } : item));
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveChecklistConfig(items, user.id);
    if (result.success) {
      toast({ title: 'Checklist Saved', description: 'The readiness checklist has been updated for all students.' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSaving(false);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const finalItem = items.find(i => i.isFinal);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-primary" />
          <CardTitle>Readiness Checklist Items</CardTitle>
        </div>
        <CardDescription>
          Manage the items shown in each student&apos;s Readiness Checklist. Changes apply to all students immediately.
          Mark one item as the <span className="font-semibold text-amber-600">Final Step</span> — it will only unlock once all other items are checked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Submit Health Certificate..."
            value={newLabel}
            onChange={e => setNewLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={!newLabel.trim()} variant="outline" size="sm" className="h-10 px-4">
            <PlusCircle className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No items yet. Add items above.</p>
          ) : (
            items.map((item, idx) => (
              <div
                key={item.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg border group ${item.isFinal ? 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800' : 'bg-muted/30'}`}
              >
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => handleMoveUp(idx)} disabled={idx === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleMoveDown(idx)} disabled={idx === items.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-20">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                <Input
                  value={item.label}
                  onChange={e => handleLabelEdit(item.id, e.target.value)}
                  className="flex-1 h-8 text-sm border-transparent bg-transparent focus:bg-background focus:border-input"
                />

                {item.isFinal && (
                  <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-amber-600 border-amber-400 shrink-0">
                    Final Step
                  </Badge>
                )}
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground shrink-0">
                  #{idx + 1}
                </Badge>

                <button
                  onClick={() => handleToggleFinal(item.id)}
                  title={item.isFinal ? 'Remove final step flag' : 'Mark as final step'}
                  className={`shrink-0 transition-colors ${item.isFinal ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-400 opacity-0 group-hover:opacity-100'}`}
                >
                  <Star className="h-4 w-4" fill={item.isFinal ? 'currentColor' : 'none'} />
                </button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => handleRemove(item.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </div>

        {!finalItem && items.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Tip: Click the <Star className="h-3 w-3 inline" /> star on an item to mark it as the Final Step (e.g. &quot;Ready to Travel&quot;).
          </p>
        )}

        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save Checklist ({items.length} items)
        </Button>
      </CardContent>
    </Card>
  );
}
