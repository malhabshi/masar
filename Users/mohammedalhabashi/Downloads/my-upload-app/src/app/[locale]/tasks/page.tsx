
'use client';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { Loader2 } from 'lucide-react';
import { TaskManager } from '@/components/tasks/task-manager';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function TasksPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  
  if (isUserLoading || usersLoading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (!user) {
    return <div>Please log in to view tasks.</div>;
  }
  
  // This page is primarily for Admins/Departments to manage all tasks.
  // Employees interact with tasks on their dashboard and student profiles.
  if (user.role === 'employee') {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>Task View</CardTitle>
                  <CardDescription>Please see your dashboard and individual student profiles for your assigned tasks.</CardDescription>
              </CardHeader>
          </Card>
      )
  }

  return (
    <TaskManager currentUser={user} users={users} />
  );
}
