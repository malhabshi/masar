
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { User, Task } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { useMemo } from 'react';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { TaskList } from '@/components/dashboard/task-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';

function AdminDashboard({ user, users }: { user: User, users: User[] }) {
    const { firestore } = useFirebase();

    const tasksCollection = useMemo(() => !firestore ? null : collection(firestore, 'tasks'), [firestore]);
    const { data: tasks, isLoading: areTasksLoading } = useCollection<Task>(tasksCollection);
    const sortedTasks = useMemo(() => tasks?.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || [], [tasks]);

    const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <SendTaskForm recipients={users} currentUser={user} />
                <TaskList tasks={sortedTasks} users={users} currentUser={user} isLoading={areTasksLoading} />
            </div>
            <div className="space-y-6">
                <UpcomingEventsCard currentUser={user} />
                <PersonalTodoList />
            </div>
        </div>
    );
}

function EmployeeDashboard({ user, users }: { user: User, users: User[] }) {
    const { firestore } = useFirebase();
    const { id: currentUserId, civilId: currentUserCivilId } = user;

    // Query for tasks sent TO this employee specifically
    const receivedTasksQuery = useMemo(() => {
        if (!firestore) return null;
        return query(collection(firestore, 'tasks'), where('recipientId', '==', currentUserId));
    }, [firestore, currentUserId]);
    const { data: receivedTasks, isLoading: receivedTasksLoading } = useCollection<Task>(receivedTasksQuery);

    // Query for tasks sent to ALL employees
    const allEmployeeTasksQuery = useMemo(() => {
        if (!firestore) return null;
        return query(collection(firestore, 'tasks'), where('recipientId', '==', 'all'));
    }, [firestore]);
    const { data: allEmployeeTasks, isLoading: allTasksLoading } = useCollection<Task>(allEmployeeTasksQuery);
    
    // Combine and sort tasks
    const allTasks = useMemo(() => {
        const combined = [...(receivedTasks || []), ...(allEmployeeTasks || [])];
        const uniqueTasks = Array.from(new Map(combined.map(task => [task.id, task])).values());
        return uniqueTasks.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [receivedTasks, allEmployeeTasks]);
    
    const isLoading = receivedTasksLoading || allTasksLoading;

    return (
         <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <TaskList tasks={allTasks} users={users} currentUser={user} isLoading={isLoading} />
            </div>
            <div className="space-y-6">
                <UpcomingEventsCard currentUser={user} />
                <PersonalTodoList />
            </div>
        </div>
    );
}

export default function DashboardPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();

  if (isUserLoading || usersLoading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!user) {
    // This should be handled by a layout redirect, but as a fallback
    return <div>Please log in to view the dashboard.</div>;
  }

  // Render different dashboards based on user role
  if (user.role === 'admin' || user.role === 'department') {
    return <AdminDashboard user={user} users={users} />;
  }
  
  return <EmployeeDashboard user={user} users={users} />;
}
