'use client';

import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
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

function AdminDashboard({ students, tasks, currentUser, isLoading: isParentLoading }: { students: Student[], tasks: Task[], currentUser: User, isLoading: boolean }) {
  const isLoading = isParentLoading;

  const stats = useMemo(() => {
    if (!students) return { totalStudents: 0, unassignedStudents: 0, totalApplications: 0 };
    const totalStudents = students.length;
    const unassignedStudents = students.filter(s => !s.employeeId).length;
    const totalApplications = students.reduce((acc, s) => acc + (s.applications?.length || 0), 0);
    return { totalStudents, unassignedStudents, totalApplications };
  }, [students]);

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
            <TaskList tasks={tasks} currentUser={currentUser} isLoading={isLoading} />
            <SendTaskForm currentUser={currentUser} />
        </div>
        <UpcomingEventsCard />
        <div className="flex justify-end">
            <ImportStudentsDialog currentUser={currentUser} />
        </div>
    </div>
  );
}

function EmployeeDashboard({ currentUser }: { currentUser: User }) {
    const myStudentsConstraints = useMemo(() => {
        return currentUser.civilId ? [where('employeeId', '==', currentUser.civilId)] : [];
    }, [currentUser.civilId]);

    const { data: myStudentsData, isLoading: studentsLoading } = useCollection<Student>(
        currentUser.civilId ? 'students' : '', 
        ...myStudentsConstraints
    );
    const myStudents = myStudentsData || [];

    const tasksToMeConstraints = useMemo(() => [where('recipientId', '==', currentUser.id)], [currentUser.id]);
    const { data: tasksToMeData, isLoading: tasksToMeLoading } = useCollection<Task>('tasks', ...tasksToMeConstraints);

    const tasksToAllConstraints = useMemo(() => [where('recipientId', '==', 'all')], []);
    const { data: tasksToAllData, isLoading: tasksToAllLoading } = useCollection<Task>('tasks', ...tasksToAllConstraints);

    const tasksByMeConstraints = useMemo(() => [where('authorId', '==', currentUser.id)], [currentUser.id]);
    const { data: tasksByMeData, isLoading: tasksByMeLoading } = useCollection<Task>('tasks', ...tasksByMeConstraints);

    const tasksToMe = tasksToMeData || [];
    const tasksToAll = tasksToAllData || [];
    const tasksByMe = tasksByMeData || [];
    
    const tasksDataLoading = tasksToMeLoading || tasksToAllLoading || tasksByMeLoading;
    const isLoading = studentsLoading || tasksDataLoading;

    const relevantTasks = useMemo(() => {
        const allTasks = [...tasksToMe, ...tasksToAll, ...tasksByMe];
        const uniqueTasks = Array.from(new Map(allTasks.map(task => [task.id, task])).values());
        return uniqueTasks.sort((a, b) => sortByDate(a, b));
    }, [tasksToMe, tasksToAll, tasksByMe]);

    const stats = useMemo(() => {
        const myTotalStudents = myStudents.length;
        const myPendingApplications = myStudents.reduce((acc, s) => {
            return acc + (s.applications?.filter(a => a.status === 'Pending').length || 0);
        }, 0);
        return { myTotalStudents, myPendingApplications };
    }, [myStudents]);


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
                <TaskList tasks={relevantTasks} currentUser={currentUser} isLoading={isLoading} />
                <PersonalTodoList />
            </div>
            <UpcomingEventsCard />
        </div>
    );
}

function DepartmentDashboard({ students, tasks, currentUser, isLoading: isParentLoading }: { students: Student[], tasks: Task[], currentUser: User, isLoading: boolean }) {
     const isLoading = isParentLoading;

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
                <TaskList tasks={tasks} currentUser={currentUser} isLoading={isLoading} />
                <UpcomingEventsCard />
            </div>
        </div>
    )
}

function DashboardPageContent() {
    const { user: currentUser, isUserLoading: isCurrentUserLoading } = useUser();
    
    // Admins and Departments fetch all student and task data at this top level.
    const { data: allStudents, isLoading: studentsLoading } = useCollection<Student>(
        (currentUser?.role === 'admin' || currentUser?.role === 'department') ? 'students' : ''
    );
    const { data: allTasks, isLoading: tasksLoading } = useCollection<Task>(
        (currentUser?.role === 'admin' || currentUser?.role === 'department') ? 'tasks' : ''
    );

    const isAdminOrDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
    // This loading state is only for the data fetched in this parent component.
    const isParentLoading = isCurrentUserLoading || (isAdminOrDept && (studentsLoading || tasksLoading));

    // The initial spinner only waits for the user to be identified.
    if (isCurrentUserLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    if (!currentUser) return <p>You must be logged in to view the dashboard.</p>;
    
    const sortedTasks = useMemo(() => {
        if (!allTasks) return [];
        return allTasks.sort((a,b) => sortByDate(a,b));
    }, [allTasks]);

    // Render the appropriate dashboard based on the user's role.
    // Each dashboard component is now responsible for its own user list and detailed loading states.
    switch (currentUser.role) {
        case 'admin':
            return <AdminDashboard students={allStudents || []} tasks={sortedTasks} currentUser={currentUser} isLoading={isParentLoading} />;
        case 'employee':
            return <EmployeeDashboard currentUser={currentUser} />;
        case 'department':
            return <DepartmentDashboard students={allStudents || []} tasks={sortedTasks} currentUser={currentUser} isLoading={isParentLoading} />;
        default:
            return <p>Unknown user role. Cannot display dashboard.</p>;
    }
}

export default function DashboardPage() {
    return <DashboardPageContent />;
}
    