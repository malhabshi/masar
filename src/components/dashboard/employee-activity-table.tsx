
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
import type { TimeLog } from '@/lib/types';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect } from 'react';
import { formatDate, toDate } from '@/lib/timestamp-utils';
import { useUsers } from '@/contexts/users-provider';

interface EmployeeActivityTableProps {
  timeLogs: TimeLog[];
}

export function EmployeeActivityTable({ timeLogs }: EmployeeActivityTableProps) {
  const [isClient, setIsClient] = useState(false);
  const { getUserById } = useUsers();

  useEffect(() => {
    setIsClient(true);
  }, []);

  const calculateTotalTime = (clockIn: string, clockOut?: string | null) => {
    const start = toDate(clockIn);
    const end = toDate(clockOut);
    if (!start || !end) {
      return 'N/A';
    }
    const diff = end.getTime() - start.getTime();
    if (diff < 0) return 'Invalid';
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
            const employee = getUserById(log.employeeId);
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
                <TableCell>{isClient && log.clockOut ? toDate(log.clockOut)?.toLocaleTimeString() : 'In Progress'}</TableCell>
                <TableCell>{isClient ? calculateTotalTime(log.clockIn, log.clockOut) : <Skeleton className="h-4 w-12" />}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
