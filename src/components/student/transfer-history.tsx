'use client';

import { useMemo, useState, useEffect } from 'react';
import type { Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ArrowRight } from 'lucide-react';
import { formatDate } from '@/lib/timestamp-utils';
import { useUserCacheById, useUserCacheByCivilId } from '@/hooks/use-user-cache';

interface TransferHistoryProps {
  transferHistory: NonNullable<Student['transferHistory']>;
}

export function TransferHistory({ transferHistory }: TransferHistoryProps) {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const employeeCivilIds = useMemo(() => {
    const ids = new Set<string>();
    transferHistory.forEach(t => {
      if (t.fromEmployeeId) ids.add(t.fromEmployeeId);
      if (t.toEmployeeId) ids.add(t.toEmployeeId);
    });
    return Array.from(ids);
  }, [transferHistory]);

  const adminIds = useMemo(() => {
      return [...new Set(transferHistory.map(t => t.transferredBy))];
  }, [transferHistory]);

  const { userMap: employeesByCivilId } = useUserCacheByCivilId(employeeCivilIds);
  const { userMap: adminsById } = useUserCacheById(adminIds);


  return (
    <Card>
      <CardHeader>
        <CardTitle>Transfer History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {transferHistory.map((transfer, index) => {
          const fromEmployee = transfer.fromEmployeeId ? employeesByCivilId.get(transfer.fromEmployeeId) : null;
          const toEmployee = employeesByCivilId.get(transfer.toEmployeeId);
          const admin = adminsById.get(transfer.transferredBy);

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
                        {toEmployee ? (
                           <>
                                <Avatar className="h-8 w-8">
                                    <AvatarImage src={toEmployee.avatarUrl} alt={toEmployee.name} />
                                    <AvatarFallback>{toEmployee.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <span className="font-medium">{toEmployee.name}</span>
                            </>
                        ) : (
                            <span className="font-medium text-muted-foreground">...</span>
                        )}
                    </div>
                </div>
                <div className="text-xs text-muted-foreground mt-2 pl-1">
                    Transferred on {isClient ? formatDate(transfer.date) : '...'} by {admin?.name || '...'}
                </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
