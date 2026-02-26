'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@/hooks/use-user';
import { EmployeeApplicantsPage } from './employee-page';
import { AdminApplicantsPage } from './admin-page';
import { Loader2 } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user, isUserLoading } = useUser();

  useEffect(() => {
    console.log('✅ Component mounted:', 'ApplicantsPage');
    setIsMounted(true);
    return () => console.log('❌ Component unmounted:', 'ApplicantsPage');
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
    return <EmployeeApplicantsPage />;
  }

  if (user.role === 'admin' || user.role === 'department') {
    return <AdminApplicantsPage />;
  }

  // Fallback for roles that shouldn't see this page anyway
  return (
    <Card>
      <CardHeader>
        <CardTitle>Access Denied</CardTitle>
        <CardDescription>Your account role does not have access to this list.</CardDescription>
      </CardHeader>
    </Card>
  );
}
