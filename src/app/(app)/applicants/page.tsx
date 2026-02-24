'use client';

import { useUser } from '@/hooks/use-user';
import { EmployeeApplicantsPage } from './employee-page';
import { AdminApplicantsPage } from './admin-page';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function ApplicantsPage() {
  const { user, isUserLoading } = useUser();
  
  if (isUserLoading) {
    return (
        <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
    );
  }
  
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You need to be logged in to view applicants.</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  
  if (user.role === 'employee') {
    return <EmployeeApplicantsPage />;
  }
  
  // For 'admin' and 'department'
  return <AdminApplicantsPage />;
}
