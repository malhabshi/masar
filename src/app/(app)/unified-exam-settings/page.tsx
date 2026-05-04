'use client';

import { useState } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, addDoc, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import type { UnifiedExamDate } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function UnifiedExamSettingsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const [newLabel, setNewLabel] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const { data: examDates, isLoading } = useCollection<UnifiedExamDate>('unified_exam_dates');

  if (!user || !['admin', 'adminplus'].includes(user.role)) {
    return <div className="p-8 text-center text-muted-foreground">Access Denied.</div>;
  }

  const handleAdd = async () => {
    if (!newLabel.trim()) return;
    setIsAdding(true);
    try {
      await addDoc(collection(firestore, 'unified_exam_dates'), {
        label: newLabel.trim(),
        isActive: true,
        createdAt: new Date().toISOString(),
      });
      setNewLabel('');
      toast({ title: 'Exam date added' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to add', description: e.message });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(firestore, 'unified_exam_dates', id));
      toast({ title: 'Exam date removed' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to delete', description: e.message });
    }
  };

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(firestore, 'unified_exam_dates', id), { isActive: !current });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to update', description: e.message });
    }
  };

  const sorted = [...(examDates || [])].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Unified Exam Settings</h1>
        <p className="text-muted-foreground mt-1">Manage the exam dates shown in the Unified Exam task form.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add Exam Date</CardTitle>
          <CardDescription>Enter a label like "June 15, 2026 – Morning Session".</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. June 15, 2026 – Morning"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            />
            <Button onClick={handleAdd} disabled={isAdding || !newLabel.trim()}>
              {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exam Dates</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : sorted.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No exam dates added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.label}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Switch
                          checked={d.isActive}
                          onCheckedChange={() => handleToggleActive(d.id, d.isActive)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.role === 'admin' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(d.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
