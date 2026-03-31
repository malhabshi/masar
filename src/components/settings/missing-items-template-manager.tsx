'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle, Trash2, ClipboardList, GripVertical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { getMissingItemTemplates, saveMissingItemTemplates } from '@/lib/actions';
import { useUser } from '@/hooks/use-user';

export function MissingItemsTemplateManager() {
  const { toast } = useToast();
  const { user } = useUser();
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const [newItem, setNewItem] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    getMissingItemTemplates().then(saved => {
      if (saved && saved.length > 0) {
        setItems(saved);
      } else {
        // Load defaults
        setItems([
          { id: '1', text: 'Passport Copy' },
          { id: '2', text: 'High School Transcript' },
          { id: '3', text: 'Graduation Certificate' },
          { id: '4', text: 'English Proficiency (IELTS)' },
          { id: '5', text: 'Personal Statement (CV)' },
          { id: '6', text: 'Recommendation Letters (2)' },
          { id: '7', text: 'Financial Letter' },
          { id: '8', text: 'TB Certificate' },
          { id: '9', text: 'Previous Visas' },
        ]);
      }
      setIsLoading(false);
    });
  }, []);

  const handleAdd = () => {
    const text = newItem.trim();
    if (!text) return;
    const newEntry = { id: `custom-${Date.now()}`, text };
    setItems(prev => [...prev, newEntry]);
    setNewItem('');
  };

  const handleRemove = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    const result = await saveMissingItemTemplates(items, user.id);
    if (result.success) {
      toast({ title: 'Templates Saved', description: 'The missing items template list has been updated.' });
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

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <CardTitle>Missing Items Templates</CardTitle>
        </div>
        <CardDescription>
          Manage the quick-add template list shown in each student profile under "Missing Items". 
          These are common documents you frequently request from students.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add new item */}
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Medical Certificate..."
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="flex-1"
          />
          <Button onClick={handleAdd} disabled={!newItem.trim()} variant="outline" size="sm" className="h-10 px-4">
            <PlusCircle className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        {/* Item list */}
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-6">No templates yet. Add items above.</p>
          ) : (
            items.map((item, idx) => (
              <div key={item.id} className="flex items-center gap-2 p-2.5 bg-muted/30 rounded-lg border group">
                <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                <span className="text-sm flex-1">{item.text}</span>
                <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground shrink-0">#{idx + 1}</Badge>
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

        {/* Save button */}
        <Button onClick={handleSave} disabled={isSaving} className="w-full">
          {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Save Template List ({items.length} items)
        </Button>
      </CardContent>
    </Card>
  );
}
