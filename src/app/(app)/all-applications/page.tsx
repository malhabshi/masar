'use client';

import { useUser } from '@/hooks/use-user';
import { AllApplicationsView } from '@/components/applications/all-applications-view';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AllApplicationsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user, isUserLoading, effectiveRole } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || isUserLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const isManagement = effectiveRole === 'admin' || effectiveRole === 'department';

  if (!user || !isManagement) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>Only administrators and department users can access this page.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <AllApplicationsView />;
}
