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
import type { Student, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Loader2, UserPlus, ArrowRightLeft } from 'lucide-react';

interface TransferStudentDialogProps {
  student: Student;
  employees: User[];
  currentUser: AppUser;
  actionType: 'assign' | 'transfer';
}

export function TransferStudentDialog({ student, employees, currentUser, actionType }: TransferStudentDialogProps) {
  const { toast } = useToast();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  const isAssignAction = actionType === 'assign';

  const availableEmployees = employees.filter(e => e.civilId !== student.employeeId);
  const currentEmployee = employees.find(e => e.civilId === student.employeeId);

  const handleTransfer = async () => {
    if (!selectedEmployeeId) {
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
        toast({ variant: 'destructive', title: 'Error', description: `Selected employee '${newEmployee.name}' is missing a Civil ID.` });
        return;
    }
    
    const fromEmployee = student.employeeId ? employees.find(e => e.civilId === student.employeeId) : null;

    setIsTransferring(true);
    
    // The server action handles all updates: employeeId, history, notes, and notifications.
    const result = await transferStudent(student.id, newEmployee, currentUser.id, student.name, fromEmployee?.name || null);

    if (result.success) {
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
        <Button 
          variant={isAssignAction ? "default" : "outline"}
          size="sm"
          className={actionType === 'transfer' ? 'border-yellow-500 text-yellow-600 hover:bg-yellow-500/10 hover:text-yellow-700' : ''}
        >
          {isAssignAction ? (
              <UserPlus className="mr-2 h-4 w-4" />
          ) : (
              <ArrowRightLeft className="mr-2 h-4 w-4" />
          )}
          {isAssignAction ? 'Assign' : 'Approve Transfer'}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isAssignAction ? `Assign ${student.name}`: `Approve Transfer for ${student.name}`}</DialogTitle>
          <DialogDescription>
            {isAssignAction
              ? 'Assign this student to an employee. The employee will be notified.'
              : `Transfer this student to another employee. The current employee (${currentEmployee?.name}) has requested this transfer.`}
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
