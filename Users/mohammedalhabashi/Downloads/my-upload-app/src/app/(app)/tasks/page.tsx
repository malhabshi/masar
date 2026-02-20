'use client';

import { TaskManager } from '@/components/tasks/task-manager';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function TasksPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();

  const isLoading = isUserLoading || usersLoading;

  if (isLoading) {
      return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (!currentUser || !['admin', 'department'].includes(currentUser.role)) {
       return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
            </Card>
        );
  }

  return <TaskManager currentUser={currentUser} users={users} />;
}
