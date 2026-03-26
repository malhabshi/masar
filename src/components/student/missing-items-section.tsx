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
import { doc, arrayUnion } from 'firebase/firestore';
import { addMissingItemToStudent, removeMissingItemFromStudent, markMissingItemAsReceived } from '@/lib/actions';
import { Badge } from '@/components/ui/badge';
import { 
    Select, 
    SelectContent, 
    SelectGroup, 
    SelectItem, 
    SelectLabel, 
    SelectTrigger, 
    SelectValue 
} from '@/components/ui/select';

interface MissingItemsSectionProps {
  student: Student;
  currentUser: AppUser;
}

export function MissingItemsSection({ student, currentUser }: MissingItemsSectionProps) {
  const [newItem, setNewItem] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const templates = [
    { id: '1', text: 'Passport Copy', category: 'General' },
    { id: '2', text: 'High School Transcript', category: 'Academic' },
    { id: '3', text: 'Graduation Certificate', category: 'Academic' },
    { id: '4', text: 'English Proficiency (IELTS)', category: 'Academic' },
    { id: '5', text: 'Personal Statement (CV)', category: 'General' },
    { id: '6', text: 'Recommendation Letters (2)', category: 'General' },
    { id: '7', text: 'Financial Letter', category: 'Visa' },
    { id: '8', text: 'TB Certificate', category: 'Visa' },
    { id: '9', text: 'Previous Visas', category: 'Visa' },
  ];

  const canManage = currentUser.role === 'admin' || currentUser.role === 'department';
  const isEmployee = currentUser.role === 'employee';

  // When an employee views this component, clear the 'new' indicator
  useEffect(() => {
    if (isEmployee && student.newMissingItemsForEmployee && student.newMissingItemsForEmployee > 0 && (!student.missingItemsViewedBy || !student.missingItemsViewedBy.includes(currentUser.id))) {
      const studentDocRef = doc(firestore, 'students', student.id);
      updateDocumentNonBlocking(studentDocRef, { missingItemsViewedBy: arrayUnion(currentUser.id) as any });
    }
    // This should only run once when the component mounts for the employee
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEmployee, student.id, student.newMissingItemsForEmployee]);

  const handleAddItem = async (text?: string) => {
    const itemText = text || newItem.trim();
    if (!itemText) return;

    setIsLoading(true);
    const result = await addMissingItemToStudent(student.id, itemText, currentUser.id);
    
    if (result.success) {
        toast({ title: 'Item Added', description: `"${itemText}" added.` });
        if (!text) setNewItem('');
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
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No missing items.</p>
          )}
        </div>
      </CardContent>
      {canManage && (
        <CardFooter className="border-t pt-4 flex flex-col gap-3">
          <div className="w-full">
            <Select onValueChange={(val) => handleAddItem(val)}>
                <SelectTrigger className="w-full text-xs h-9 bg-primary/5 border-primary/20">
                    <SelectValue placeholder="Quick add from templates..." />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectLabel>Common Requirements</SelectLabel>
                        {templates.map((t, idx) => (
                            <SelectItem key={t.id || idx} value={t.text || ''}>{t.text}</SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
          </div>
          <div className="flex w-full items-center space-x-2">
            <Input
              placeholder="Or type custom item..."
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddItem(); }}
              className="text-xs h-9"
            />
            <Button onClick={() => handleAddItem()} disabled={isLoading || !newItem.trim()} size="sm" className="h-9 px-3">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            </Button>
          </div>
        </CardFooter>
      )}
    </Card>
  );
}
