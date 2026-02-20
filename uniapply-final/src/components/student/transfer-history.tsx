'use client';

import type { Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

interface TransferHistoryProps {
  transferHistory: NonNullable<Student['transferHistory']>;
  users: User[];
}

export function TransferHistory({ transferHistory, users }: TransferHistoryProps) {
  const getEmployee = (employeeId: string | null) => {
    if (!employeeId) return null;
    // transferHistory stores the employee's Civil ID
    return users.find(u => u.civilId === employeeId);
  }
  
  const getAdmin = (adminId: string) => {
      // transferredBy stores the user's main ID
      return users.find(u => u.id === adminId);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {transferHistory.map((transfer, index) => {
          const fromEmployee = getEmployee(transfer.fromEmployeeId);
          const toEmployee = getEmployee(transfer.toEmployeeId);
          const admin = getAdmin(transfer.transferredBy);

          return (
            <div key={index} className="flex flex-col">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                        {fromEmployee ? (
                            <>
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={fromEmployee.avatarUrl} alt={fromEmployee.name} />
                                    <AvatarFallback>{fromEmployee.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{fromEmployee.name}</span>
                            </>
                        ) : (
                            <span className="font-medium text-muted-foreground">Unassigned</span>
                        )}
                    </div>
                    <ArrowRight className="h-5 w-5 text-muted-foreground" />
                    <div className="flex items-center gap-2">
                        {toEmployee && (
                           <>
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={toEmployee.avatarUrl} alt={toEmployee.name} />
                                    <AvatarFallback>{toEmployee.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{toEmployee.name}</span>
                            </>
                        )}
                    </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2 pl-1">
                    Transferred on {format(new Date(transfer.date), 'PPP')} by {admin?.name || 'Admin'}
                </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
