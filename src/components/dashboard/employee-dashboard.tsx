'use client';

import { useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Student, Task } from '@/lib/types';
import { Users, FileText } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';
import type { AppUser } from '@/hooks/use-user';

// Components
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';

export default function EmployeeDashboard({ currentUser }: { currentUser: AppUser }) {
    const myStudentsConstraints = useMemoFirebase(() => {
        return currentUser.civilId ? [where('employeeId', '==', currentUser.civilId)] : [];
    }, [currentUser.civilId]);

    const { data: myStudentsData, isLoading: studentsLoading } = useCollection<Student>(
        currentUser.civilId ? 'students' : '', 
        ...myStudentsConstraints
    );
    const myStudents = useMemo(() => myStudentsData || [], [myStudentsData]);

    const tasksToMeConstraints = useMemoFirebase(() => [where('recipientId', '==', currentUser.id)], [currentUser.id]);
    const { data: tasksToMeData, isLoading: tasksToMeLoading } = useCollection<Task>('tasks', ...tasksToMeConstraints);

    const tasksToAllConstraints = useMemoFirebase(() => [where('recipientId', '==', 'all')], []);
    const { data: tasksToAllData, isLoading: tasksToAllLoading } = useCollection<Task>('tasks', ...tasksToAllConstraints);

    const tasksByMeConstraints = useMemoFirebase(() => [where('authorId', '==', currentUser.id)], [currentUser.id]);
    const { data: tasksByMeData, isLoading: tasksByMeLoading } = useCollection<Task>('tasks', ...tasksByMeConstraints);

    const tasksToMe = useMemo(() => tasksToMeData || [], [tasksToMeData]);
    const tasksToAll = useMemo(() => tasksToAllData || [], [tasksToAllData]);
    const tasksByMe = useMemo(() => tasksByMeData || [], [tasksByMeData]);
    
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
