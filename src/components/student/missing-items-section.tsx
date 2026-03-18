'use client';

import { useState, useEffect } from 'react';
import type { Student, MissingItem } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Trash2, CheckCircle, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { addMissingItemToStudent, removeMissingItemFromStudent, markMissingItemAsReceived } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';

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

  const handleAddItem = async () => {
    if (!newItem.trim()) return;

    setIsLoading(true);
    const result = await addMissingItemToStudent(student.id, newItem.trim(), currentUser.id);
    
    if (result.success) {
        toast({ title: 'Item Added', description: `"${newItem.trim()}" added to the list.` });
        setNewItem('');
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  const handleRemoveItem = async (itemToRemove: string | MissingItem) => {
    setIsLoading(true);
    const result = await removeMissingItemFromStudent(student.id, itemToRemove);

    if (result.success) {
        toast({ title: 'Item Removed', description: `Item has been removed.` });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  const handleMarkAsReceived = async (itemReceived: string | MissingItem) => {
    setIsLoading(true);
    const result = await markMissingItemAsReceived(student.id, itemReceived, currentUser.id);
    
    if (result.success) {
        toast({ title: 'Item Received', description: `Item marked as received. An admin has been notified.` });
    } else {
        toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  const renderItemContent = (item: string | MissingItem) => {
    if (typeof item === 'string') {
      return <span className="text-sm">{item}</span>;
    }
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold">{item.text}</span>
        <div className="flex items-center gap-1.5">
          <Badge variant="secondary" className="text-[9px] h-4 py-0 font-black uppercase tracking-tighter bg-primary/10 text-primary border-primary/20">
            <Building2 className="h-2 w-2 mr-1" />
            {item.department}
          </Badge>
        </div>
      </div>
    );
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
              <div key={index} className="flex items-start justify-between gap-2 p-2 rounded-md bg-muted/50">
                <div className="flex-1 min-w-0">
                  {renderItemContent(item)}
                </div>
                <div className="flex gap-1 shrink-0">
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
