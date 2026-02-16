
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { TaskManager } from '@/components/tasks/task-manager';
import { Loader2 } from 'lucide-react';

export default function TasksPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();

  if (isUserLoading || usersLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!user || !['admin', 'department'].includes(user.role)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div>
      <TaskManager currentUser={user} users={users} />
    </div>
  );
}
