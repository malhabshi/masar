'use client';

import { EmployeeStatsView } from '@/components/stats/employee-stats-view';
import { useUser } from '@/hooks/use-user';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function EmployeeStudentsCountPage() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user || !['admin', 'department'].includes(user.role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <EmployeeStatsView />;
}
