
'use client';

import { useState, useTransition } from 'react';
import type { User, Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, ListChecks, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { addMissingItem, removeMissingItem } from '@/lib/actions';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface MissingItemsProps {
  student: Student;
  currentUser: User;
}

export function MissingItems({ student, currentUser }: MissingItemsProps) {
  const { toast } = useToast();
  const [newItem, setNewItem] = useState('');
  const [isPending, startTransition] = useTransition();
  const [itemBeingProcessed, setItemBeingProcessed] = useState<string | null>(null);
  const { firestore } = useFirebase();
  
  const missingItems = student.missingItems || [];
  const canEdit = ['admin', 'department'].includes(currentUser.role);

  const handleAddItem = () => {
    if (!newItem.trim() || !firestore) return;
    
    setItemBeingProcessed('__adding__');
    startTransition(async () => {
        const result = await addMissingItem(student.id, newItem, student.name, student.employeeId);
        if (result.success) {
            const newMissingItems = [...missingItems, newItem];
            const updates: Partial<Student> = { missingItems: newMissingItems };
            if (canEdit && student.employeeId) {
                updates.newMissingItemsForEmployee = (student.newMissingItemsForEmployee || 0) + 1;
            }

            const studentDocRef = doc(firestore, 'students', student.id);
            updateDocumentNonBlocking(studentDocRef, updates);

            setNewItem('');
            toast({ title: 'Item Added', description: result.message });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setItemBeingProcessed(null);
    });
  };

  const handleRemoveItem = (itemToRemove: string) => {
    if (!firestore) return;
    setItemBeingProcessed(itemToRemove);
    startTransition(async () => {
        const result = await removeMissingItem(student.id, itemToRemove, student.name, student.employeeId);
        if (result.success) {
            const newMissingItems = missingItems.filter(item => item !== itemToRemove);
            const studentDocRef = doc(firestore, 'students', student.id);
            updateDocumentNonBlocking(studentDocRef, { missingItems: newMissingItems });
            toast({ title: 'Item Removed', description: result.message });
        } else {
            toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setItemBeingProcessed(null);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Missing Items</CardTitle>
      </CardHeader>
      <CardContent>
        {missingItems.length > 0 ? (
          <ul className="space-y-2">
            {missingItems.map((item, index) => (
              <li key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                <span className="text-sm">{item}</span>
                {canEdit && (
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleRemoveItem(item)} disabled={isPending}>
                    {isPending && itemBeingProcessed === item ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-center text-sm text-muted-foreground py-8">
            <ListChecks className="mx-auto h-8 w-8 mb-2" />
            No missing items reported.
          </div>
        )}
      </CardContent>
      {canEdit && (
        <CardFooter className="border-t pt-4">
          <div className="flex w-full items-center space-x-2">
            <Input
              placeholder="Add a missing item..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {if (e.key === 'Enter') handleAddItem()}}
              disabled={isPending}
            />
            <Button onClick={handleAddItem} disabled={isPending || !newItem.trim()}>
              {isPending && itemBeingProcessed === '__adding__' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Add'}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
