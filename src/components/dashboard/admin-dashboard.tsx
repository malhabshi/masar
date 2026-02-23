'use client';

import { useMemo } from 'react';
import { useCollection } from '@/firebase/client';
import type { Student, Task } from '@/lib/types';
import { Users, FileText, UserPlus } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';

// Components
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { ImportStudentsDialog } from '@/components/dashboard/import-students-dialog';
import type { AppUser } from '@/hooks/use-user';

export default function AdminDashboard({ currentUser }: { currentUser: AppUser }) {
  const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>('students');
  const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>('tasks');

  const students = useMemo(() => studentsData || [], [studentsData]);
  const tasks = useMemo(() => tasksData || [], [tasksData]);
  
  const isLoading = studentsLoading || tasksLoading;

  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a,b) => sortByDate(a,b));
  }, [tasks]);

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
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 space-y-6">
                <SendTaskForm currentUser={currentUser} />
                <TaskList tasks={sortedTasks} currentUser={currentUser} isLoading={isLoading} />
            </div>
            <div className="space-y-6">
                <UpcomingEventsCard />
                <ImportStudentsDialog currentUser={currentUser} />
            </div>
        </div>
    </div>
  );
}
