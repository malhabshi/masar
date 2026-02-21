'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { TimeLog, User } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect } from 'react';
import { formatDate, toDate } from '@/lib/timestamp-utils';

interface EmployeeActivityTableProps {
  timeLogs: TimeLog[];
  users: User[];
}

export function EmployeeActivityTable({ timeLogs, users }: EmployeeActivityTableProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const getEmployee = (employeeId: string) => {
    return users.find(u => u.id === employeeId);
  };

  const calculateTotalTime = (clockIn: string, clockOut: string) => {
    const start = toDate(clockIn);
    const end = toDate(clockOut);
    if (!start || !end) {
      return 'Invalid Time';
    }
    const diff = end.getTime() - start.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const sortedTimeLogs = [...timeLogs].sort((a, b) => {
    const dateA = toDate(b.date)?.getTime() || 0;
    const dateB = toDate(a.date)?.getTime() || 0;
    return dateA - dateB;
  });

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Employee</TableHead>
            <TableHead>Date</TableHead>
            <TableHead>Clock In</TableHead>
            <TableHead>Clock Out</TableHead>
            <TableHead>Total Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedTimeLogs.map((log) => {
            const employee = getEmployee(log.employeeId);
            return (
              <TableRow key={log.id}>
                <TableCell>
                  {employee ? (
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={employee.avatarUrl} alt={employee.name} data-ai-hint="employee avatar" />
                        <AvatarFallback>{employee.name.charAt(0)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{employee.name}</div>
                        <div className="text-sm text-muted-foreground">{employee.email}</div>
                      </div>
                    </div>
                  ) : 'Unknown Employee'}
                </TableCell>
                <TableCell>{isClient ? formatDate(log.date) : <Skeleton className="h-4 w-24" />}</TableCell>
                <TableCell>{isClient ? toDate(log.clockIn)?.toLocaleTimeString() : <Skeleton className="h-4 w-16" />}</TableCell>
                <TableCell>{isClient ? toDate(log.clockOut)?.toLocaleTimeString() : <Skeleton className="h-4 w-16" />}</TableCell>
                <TableCell>{isClient ? calculateTotalTime(log.clockIn, log.clockOut) : <Skeleton className="h-4 w-12" />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
