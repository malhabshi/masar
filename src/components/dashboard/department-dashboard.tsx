
'use client';

import { useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { orderBy, where } from 'firebase/firestore';
import type { Student, Task } from '@/lib/types';
import { Users, FileText, AlertCircle, ArrowRight } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';
import type { AppUser } from '@/hooks/use-user';
import Link from 'next/link';

// Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { SendTaskForm } from './send-task-form';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { Badge } from '@/components/ui/badge';

export default function DepartmentDashboard({ currentUser }: { currentUser: AppUser }) {
     const isDept = currentUser?.role === 'department' || currentUser?.role === 'admin';
     const studentsPath = isDept ? 'students' : '';
     const tasksPath = currentUser ? 'tasks' : '';

     const studentsConstraints = useMemoFirebase(() => {
        if (!studentsPath) return [];
        return [orderBy('createdAt', 'desc')];
     }, [studentsPath]);

     const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);
     const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(tasksPath);
     
     const students = useMemo(() => studentsData || [], [studentsData]);
     const tasks = useMemo(() => tasksData || [], [tasksData]);

     const isLoading = studentsLoading || tasksLoading;

     const changeAgentStudents = useMemo(() => {
        return students.filter(s => s.changeAgentRequired);
     }, [students]);

     const sortedTasks = useMemo(() => {
        if (!tasks) return [];
        return [...tasks].sort((a,b) => sortByDate(a,b));
    }, [tasks]);

     const stats = useMemo(() => {
        if(!students) return { totalStudents: 0, totalApplications: 0 };
        const totalStudents = students.length;
        const totalApplications = students.reduce((acc, s) => acc + (s.applications?.length || 0), 0);
        return { totalStudents, totalApplications };
    }, [students]);

    if (!isDept) return null;

    return (
        <div className="space-y-6">
            {changeAgentStudents.length > 0 && (
              <Card className="border-red-500 bg-red-50/10">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="h-5 w-5" />
                    <CardTitle className="text-lg">Change Agent Monitoring</CardTitle>
                  </div>
                  <CardDescription>Active flags requiring management oversight.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {changeAgentStudents.map(student => (
                      <Link key={student.id} href={`/student/${student.id}`}>
                        <Badge className="bg-black text-red-500 border-red-500 border-2 hover:bg-black/90 px-3 py-1 flex items-center gap-2">
                          {student.name}
                          <ArrowRight className="h-3 w-3" />
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

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
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2 space-y-6">
                    <SendTaskForm currentUser={currentUser} />
                    <TaskList tasks={sortedTasks} currentUser={currentUser} isLoading={isLoading} />
                </div>
                <div className="space-y-6">
                    <UpcomingEventsCard />
                    <PersonalTodoList />
                </div>
            </div>
        </div>
    )
}
