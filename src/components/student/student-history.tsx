'use client';
import type { Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { UserPlus, ArrowRightCircle, FilePlus, UserCheck } from 'lucide-react';
import { format } from 'date-fns';
import { useState, useEffect } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

interface StudentHistoryProps {
  student: Student;
  users: User[];
}

type HistoryEvent = {
  id: string;
  date: string;
  content: React.ReactNode;
  icon: React.ElementType;
};

export function StudentHistory({ student, users }: StudentHistoryProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const getEmployee = (employeeId: string | null): User | undefined => {
    if (!employeeId) return undefined;
    return users.find(u => u.id === employeeId);
  }

  const allEvents: HistoryEvent[] = [];

  // 1. Profile Creation
  allEvents.push({
    id: `creation-${student.id}`,
    date: student.createdAt,
    content: <p>Student profile was created.</p>,
    icon: FilePlus,
  });

  const sortedTransfers = (student.transferHistory || []).slice().sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // 2. Handle initial assignment and transfers
  if (sortedTransfers.length > 0) {
    // If there's transfer history, use it as the source of truth
    const firstTransfer = sortedTransfers[0];
    if (firstTransfer.fromEmployeeId) {
        // There was an employee before the first recorded transfer
        const initialEmployee = getEmployee(firstTransfer.fromEmployeeId);
        allEvents.push({
            id: `initial-assign-${student.id}`,
            date: student.createdAt, // Assumption: assigned at creation
            content: <p>Initially assigned to <span className="font-semibold">{initialEmployee?.name || 'Unknown'}</span>.</p>,
            icon: UserCheck
        });
    }

    sortedTransfers.forEach((transfer, index) => {
        const fromEmployee = getEmployee(transfer.fromEmployeeId);
        const toEmployee = getEmployee(transfer.toEmployeeId);
        const admin = getEmployee(transfer.transferredBy);

        if (!fromEmployee) { // This is an assignment from unassigned
            allEvents.push({
                id: `assign-${transfer.date}`,
                date: transfer.date,
                content: <p>Assigned to <span className="font-semibold">{toEmployee?.name || 'Unknown'}</span> by <span className="font-semibold">{admin?.name || 'Unknown'}</span>.</p>,
                icon: UserPlus
            });
        } else { // This is a transfer
            allEvents.push({
                id: `transfer-${transfer.date}`,
                date: transfer.date,
                content: <p>Transferred from <span className="font-semibold">{fromEmployee?.name || 'Unknown'}</span> to <span className="font-semibold">{toEmployee?.name || 'Unknown'}</span> by <span className="font-semibold">{admin?.name || 'Unknown'}</span>.</p>,
                icon: ArrowRightCircle
            });
        }
    });

  } else if (student.employeeId) {
    // No transfer history, but is assigned. This is the initial assignment.
    const employee = getEmployee(student.employeeId);
    allEvents.push({
        id: `initial-assign-${student.id}`,
        date: student.createdAt, // Assumption
        content: <p>Assigned to <span className="font-semibold">{employee?.name || 'Unknown'}</span>.</p>,
        icon: UserCheck
    });
  }

  // Deduplicate and sort
  const uniqueEvents = allEvents.filter((event, index, self) =>
    index === self.findIndex((t) => (t.id === event.id))
  );

  const sortedEvents = uniqueEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Full History</CardTitle>
        <CardDescription>A complete timeline of events for this student profile.</CardDescription>
      </CardHeader>
      <CardContent className="pt-2">
        <div className="relative pl-4">
          <div className="absolute left-9 top-0 h-full w-0.5 bg-border -translate-x-1/2"></div>
          <div className="space-y-6">
            {sortedEvents.map((event) => (
              <div key={event.id} className="flex gap-4 relative">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card border z-10 shrink-0">
                  <event.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 pt-2">
                  <div className="flex justify-between items-start">
                    <div className="text-sm text-foreground">{event.content}</div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap pl-4">
                      {isClient ? format(new Date(event.date), 'PPp') : <Skeleton className="h-4 w-32" />}
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {sortedEvents.length === 1 && (
                <div className="text-sm text-center text-muted-foreground py-4">No further history events.</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
