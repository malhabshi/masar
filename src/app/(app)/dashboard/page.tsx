'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { firestore, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';
import type { Student, Task, User } from '@/lib/types';
import { Loader2, Users, FileText, UserPlus } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';

// Components
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { ImportStudentsDialog } from '@/components/dashboard/import-students-dialog';

function AdminDashboard({ students, tasks, users, currentUser, isLoading }: { students: Student[], tasks: Task[], users: User[], currentUser: User, isLoading: boolean }) {
  const stats = useMemo(() => {
    if (!students) return { totalStudents: 0, unassignedStudents: 0, totalApplications: 0 };
    const totalStudents = students.length;
    const unassignedStudents = students.filter(s => !s.employeeId).length;
    const totalApplications = students.reduce((acc, s) => acc + (s.applications?.length || 0), 0);
    return { totalStudents, unassignedStudents, totalApplications };
  }, [students]);

  const employeeRecipients = useMemo(() => users.filter(u => u.role === 'employee' || u.role === 'department'), [users]);

  return (
    <div className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{isLoading ? '...' : stats.totalStudents}</div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Unassigned Students</CardTitle>
                    <UserPlus className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{isLoading ? '...' : stats.unassignedStudents}</div>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
                    <FileText className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">{isLoading ? '...' : stats.totalApplications}</div>
                </CardContent>
            </Card>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <TaskList tasks={tasks} users={users} currentUser={currentUser} isLoading={isLoading} />
            <SendTaskForm recipients={employeeRecipients} currentUser={currentUser} />
        </div>
        <UpcomingEventsCard currentUser={currentUser} />
        <div className="flex justify-end">
            <ImportStudentsDialog currentUser={currentUser} />
        </div>
    </div>
  );
}

function EmployeeDashboard({ students, tasks, users, currentUser, isLoading }: { students: Student[], tasks: Task[], users: User[], currentUser: User, isLoading: boolean }) {
    const myStudents = useMemo(() => {
      if(!students || !currentUser.civilId) return [];
      return students.filter(s => s.employeeId === currentUser.civilId)
    }, [students, currentUser.civilId]);

    const stats = useMemo(() => {
        const myTotalStudents = myStudents.length;
        const myPendingApplications = myStudents.reduce((acc, s) => {
            return acc + (s.applications?.filter(a => a.status === 'Pending').length || 0);
        }, 0);
        return { myTotalStudents, myPendingApplications };
    }, [myStudents]);

    const relevantTasks = useMemo(() => {
        if(!tasks) return [];
        return tasks.filter(task => 
            task.recipientId === currentUser.id || 
            task.recipientId === 'all' || 
            task.authorId === currentUser.id
        ).sort((a,b) => sortByDate(a, b));
    }, [tasks, currentUser.id]);

    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">My Assigned Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.myTotalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">My Pending Applications</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.myPendingApplications}</div>
                    </CardContent>
                </Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TaskList tasks={relevantTasks} users={users} currentUser={currentUser} isLoading={isLoading} />
                <PersonalTodoList />
            </div>
            <UpcomingEventsCard currentUser={currentUser} />
        </div>
    );
}

function DepartmentDashboard({ students, tasks, users, currentUser, isLoading }: { students: Student[], tasks: Task[], users: User[], currentUser: User, isLoading: boolean }) {
     const stats = useMemo(() => {
        if(!students) return { totalStudents: 0, totalApplications: 0 };
        const totalStudents = students.length;
        const totalApplications = students.reduce((acc, s) => acc + (s.applications?.length || 0), 0);
        return { totalStudents, totalApplications };
    }, [students]);

    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.totalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.totalApplications}</div>
                    </CardContent>
                </Card>
            </div>
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TaskList tasks={tasks} users={users} currentUser={currentUser} isLoading={isLoading} />
                <UpcomingEventsCard currentUser={currentUser} />
            </div>
        </div>
    )
}

export default function DashboardPage() {
    const { user: currentUser, isUserLoading: isCurrentUserLoading } = useUser();
    const { users, usersLoading } = useUsers();

    const studentsCollection = useMemoFirebase(() => collection(firestore, 'students'), []);
    const { data: students, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    
    const tasksCollection = useMemoFirebase(() => collection(firestore, 'tasks'), []);
    const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(tasksCollection);

    const isLoading = isCurrentUserLoading || usersLoading || studentsLoading || tasksLoading;

    if (isLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (!currentUser) return <p>You must be logged in to view the dashboard.</p>;
    
    const sortedTasks = useMemo(() => {
        if (!tasks) return [];
        return tasks.sort((a,b) => sortByDate(a,b));
    }, [tasks]);

    switch (currentUser.role) {
        case 'admin':
            return <AdminDashboard students={students || []} tasks={sortedTasks} users={users} currentUser={currentUser} isLoading={isLoading} />;
        case 'employee':
            return <EmployeeDashboard students={students || []} tasks={tasks || []} users={users} currentUser={currentUser} isLoading={isLoading} />;
        case 'department':
            return <DepartmentDashboard students={students || []} tasks={sortedTasks} users={users} currentUser={currentUser} isLoading={isLoading} />;
        default:
            return <p>Unknown user role. Cannot display dashboard.</p>;
    }
}
