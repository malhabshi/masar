'use client';

import CustomizeQuestionsForm from '@/components/customize-questions-form';
import { useUser } from '@/hooks/use-user';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function CustomizeQuestionsPage() {
  const { user, isUserLoading } = useUser();

  if (isUserLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to customize questions.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return <CustomizeQuestionsForm />;
}
