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
import { Loader2 } from 'lucide-react';

interface AssignStudentDialogProps {
  student: Student;
  employees: User[];
  currentUser: AppUser;
}

export function AssignStudentDialog({ student, employees, currentUser }: AssignStudentDialogProps) {
  const { toast } = useToast();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const handleAssign = async () => {
    if (!selectedEmployeeId) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select an employee.' });
      return;
    }

    const newEmployee = employees.find(e => e.id === selectedEmployeeId);
    if (!newEmployee) {
        toast({ variant: 'destructive', title: 'Error', description: 'Could not find the selected employee.' });
        return;
    }

    setIsAssigning(true);
    const result = await transferStudent(student.id, newEmployee, currentUser.id, student.name, null);

    if (result.success) {
      toast({
        title: 'Student Assigned',
        description: result.message,
      });
      setIsOpen(false);
      setSelectedEmployeeId(null);
    } else {
      toast({
        variant: 'destructive',
        title: 'Assignment Failed',
        description: result.message,
      });
    }
    setIsAssigning(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>Assign</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign {student.name}</DialogTitle>
          <DialogDescription>
            Assign this student to an employee. The employee will be notified.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Select onValueChange={setSelectedEmployeeId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an employee" />
            </SelectTrigger>
            <SelectContent>
              {employees.map(emp => (
                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleAssign} disabled={isAssigning || !selectedEmployeeId}>
            {isAssigning && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirm Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
