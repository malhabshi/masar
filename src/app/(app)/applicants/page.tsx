'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/use-user';
import { EmployeeSimplePage } from './employee-simple-page';
import { AdminApplicantsPage } from './admin-page';
import { Loader2 } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Server and initial client render a generic loading state.
  if (!isMounted || isUserLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Once mounted, check for user.
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

  // ONLY after mounting and confirming the user, render the role-specific page.
  if (user.role === 'employee') {
    return <EmployeeSimplePage />;
  }

  // Default to Admin/Department view.
  return <AdminApplicantsPage />;
}
