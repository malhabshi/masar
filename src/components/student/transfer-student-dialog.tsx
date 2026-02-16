
'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { transferStudent } from '@/lib/actions';
import type { Student, User, Note } from '@/lib/types';
import { Loader2, Users } from 'lucide-react';
import { useFirebase, updateDocumentNonBlocking, setDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface TransferStudentDialogProps {
  student: Student;
  employees: User[];
  currentUser: User;
}

export function TransferStudentDialog({ student, employees, currentUser }: TransferStudentDialogProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  const isAssignAction = !student.employeeId;

  const availableEmployees = employees.filter(e => e.civilId !== student.employeeId);
  const currentEmployee = employees.find(e => e.civilId === student.employeeId);

  const handleTransfer = async () => {
    if (!selectedEmployeeId || !firestore) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select an employee.' });
      return;
    }

    const newEmployee = employees.find(e => e.id === selectedEmployeeId);
    if (!newEmployee) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not find the selected employee.' });
        return;
    }

    const newEmployeeCivilId = newEmployee.civilId;
    if (!newEmployeeCivilId) {
        toast({ variant: 'destructive', title: 'Error', description: `Selected employee '${newEmployee.name}' is missing a Civil ID and cannot be assigned.` });
        return;
    }
    
    const fromEmployee = student.employeeId ? employees.find(e => e.civilId === student.employeeId) : null;

    setIsTransferring(true);
    const result = await transferStudent(student.id, newEmployee, currentUser.id, student.name, fromEmployee?.name || null);

    if (result.success) {
      const studentDocRef = doc(firestore, 'students', student.id);
      
      const updates: any = {
        employeeId: newEmployeeCivilId,
        transferRequested: false, 
        isNewForEmployee: true,
      };

      const newTransferHistoryEntry = {
        fromEmployeeId: student.employeeId, // This is the Civil ID
        toEmployeeId: newEmployeeCivilId,
        date: new Date().toISOString(),
        transferredBy: currentUser.id,
      };
      updates.transferHistory = [...(student.transferHistory || []), newTransferHistoryEntry];

      const noteContent = isAssignAction
        ? `Student assigned to ${newEmployee?.name} by ${currentUser.name}.`
        : `Student transferred from ${fromEmployee?.name || 'Unassigned'} to ${newEmployee?.name} by ${currentUser.name}.`;

      const newNote: Note = {
        id: `note-transfer-${Date.now()}`,
        authorId: currentUser.id,
        content: noteContent,
        createdAt: new Date().toISOString(),
      };
      updates.notes = [...student.notes, newNote];

      updateDocumentNonBlocking(studentDocRef, updates);

      toast({
        title: isAssignAction ? 'Student Assigned' : 'Student Transferred',
        description: result.message,
      });
      setIsOpen(false);
      setSelectedEmployeeId(null);
    } else {
      toast({
        variant: 'destructive',
        title: isAssignAction ? 'Assign Failed' : 'Transfer Failed',
        description: result.message,
      });
    }
    setIsTransferring(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant={isAssignAction ? 'default' : 'outline'}>
          <Users className="mr-2 h-4 w-4" />
          {isAssignAction ? 'Assign' : 'Transfer Student'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAssignAction ? 'Assign' : 'Transfer'} {student.name}</DialogTitle>
          <DialogDescription>
            {isAssignAction
              ? 'Assign this student to an employee. The employee will be notified.'
              : 'Transfer this student to another employee. The new employee will be notified.'}
            {!isAssignAction && currentEmployee && (
              <>
                <br />
                Currently assigned to: <strong>{currentEmployee.name}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Select onValueChange={setSelectedEmployeeId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an employee" />
            </SelectTrigger>
            <SelectContent>
              {availableEmployees.map(emp => (
                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleTransfer} disabled={isTransferring || !selectedEmployeeId}>
            {isTransferring && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isAssignAction ? 'Confirm Assignment' : 'Confirm Transfer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
