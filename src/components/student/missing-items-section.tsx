'use client';

import { useState, useEffect } from 'react';
import type { Student, Note } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Trash2, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';

interface MissingItemsSectionProps {
  student: Student;
  currentUser: AppUser;
}

export function MissingItemsSection({ student, currentUser }: MissingItemsSectionProps) {
  const [newItem, setNewItem] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const canManage = currentUser.role === 'admin' || currentUser.role === 'department';
  const isEmployee = currentUser.role === 'employee';

  // When an employee views this component, clear the 'new' indicator
  useEffect(() => {
    if (isEmployee && student.newMissingItemsForEmployee && student.newMissingItemsForEmployee > 0) {
      const studentDocRef = doc(firestore, 'students', student.id);
      updateDocumentNonBlocking(studentDocRef, { newMissingItemsForEmployee: 0 });
    }
    // This should only run once when the component mounts for the employee
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployee, student.id, student.newMissingItemsForEmployee]);

  const handleAddItem = () => {
    if (!newItem.trim()) return;

    setIsLoading(true);
    const updatedItems = [...(student.missingItems || []), newItem.trim()];
    const updates = {
      missingItems: updatedItems,
      newMissingItemsForEmployee: (student.newMissingItemsForEmployee || 0) + 1,
    };

    const studentDocRef = doc(firestore, 'students', student.id);
    updateDocumentNonBlocking(studentDocRef, updates);

    toast({ title: 'Item Added', description: `"${newItem.trim()}" added to the list.` });
    setNewItem('');
    setIsLoading(false);
  };

  const handleRemoveItem = (itemToRemove: string) => {
    setIsLoading(true);
    const updatedItems = (student.missingItems || []).filter(item => item !== itemToRemove);
    const studentDocRef = doc(firestore, 'students', student.id);
    updateDocumentNonBlocking(studentDocRef, { missingItems: updatedItems });

    toast({ title: 'Item Removed', description: `"${itemToRemove}" has been removed.` });
    setIsLoading(false);
  };

  const handleMarkAsReceived = (itemReceived: string) => {
    setIsLoading(true);
    const updatedItems = (student.missingItems || []).filter(item => item !== itemReceived);
    
    const newNote: Note = {
      id: `note-item-received-${Date.now()}`,
      authorId: currentUser.id,
      content: `Marked missing item as received: "${itemReceived}"`,
      createdAt: new Date().toISOString(),
    };

    const updates = {
      missingItems: updatedItems,
      notes: [...(student.notes || []), newNote],
      unreadUpdates: (student.unreadUpdates || 0) + 1, // Notify admin/dept
    };

    const studentDocRef = doc(firestore, 'students', student.id);
    updateDocumentNonBlocking(studentDocRef, updates);
    
    toast({ title: 'Item Received', description: `"${itemReceived}" marked as received. An admin has been notified.` });
    setIsLoading(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Missing Items</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {(student.missingItems || []).length > 0 ? (
            (student.missingItems || []).map((item, index) => (
              <div key={index} className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
                <span className="text-sm">{item}</span>
                {canManage && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleRemoveItem(item)} disabled={isLoading}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                {isEmployee && (
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-success" onClick={() => handleMarkAsReceived(item)} disabled={isLoading}>
                    <CheckCircle className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No missing items.</p>
          )}
        </div>
      </CardContent>
      {canManage && (
        <CardFooter className="border-t pt-4">
          <div className="flex w-full items-center space-x-2">
            <Input
              placeholder="Add a missing item..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); }}
            />
            <Button onClick={handleAddItem} disabled={isLoading || !newItem.trim()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
