'use client';

import type { Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowRight } from 'lucide-react';
import { formatDate } from '@/lib/timestamp-utils';
import { useUsers } from '@/contexts/users-provider';

interface TransferHistoryProps {
  transferHistory: NonNullable<Student['transferHistory']>;
}

export function TransferHistory({ transferHistory }: TransferHistoryProps) {
  const { getUserByCivilId, getUserById } = useUsers();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {transferHistory.map((transfer, index) => {
          const fromEmployee = getUserByCivilId(transfer.fromEmployeeId);
          const toEmployee = getUserByCivilId(transfer.toEmployeeId);
          const admin = getUserById(transfer.transferredBy);

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
                    Transferred on {formatDate(transfer.date)} by {admin?.name || 'Admin'}
                </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
