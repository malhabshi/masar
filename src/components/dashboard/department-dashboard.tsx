
'use client';

import { useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { orderBy, where, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, Task } from '@/lib/types';
import { Users, FileText, AlertCircle, ArrowRight, UserPlus } from 'lucide-react';
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
     const isAdmin = currentUser?.role === 'admin';
     
     const studentsPath = isDept ? 'students' : '';

     const studentsConstraints = useMemoFirebase(() => {
        if (!studentsPath) return [];
        return [orderBy('createdAt', 'desc')];
     }, [studentsPath]);

     const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);

     // ✅ FIX: Correct task query for department users to show relevant tasks only
     const taskGroups = useMemo(() => {
        const groups = [currentUser.id, 'all'];
        if (currentUser.department) {
            groups.push(`dept:${currentUser.department}`);
        }
        return groups;
     }, [currentUser]);

     const taskQuery = useMemoFirebase(() => {
        if (!currentUser || !isDept) return null;
        
        // Admins see all tasks
        if (isAdmin) {
            return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
        }

        // Dept users see tasks sent to them, their department, or 'all'
        return query(
            collection(firestore, 'tasks'), 
            where('recipientIds', 'array-contains-any', taskGroups),
            orderBy('createdAt', 'desc')
        );
     }, [currentUser, isDept, isAdmin, taskGroups]);

     const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(taskQuery);
     
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
        if(!students) return { totalStudents: 0, unassignedStudents: 0, totalApplications: 0 };
        const totalStudents = students.length;
        const unassignedStudents = students.filter(s => !s.employeeId).length;
        const totalApplications = students.reduce((acc, s) => acc + (s.applications?.length || 0), 0);
        return { totalStudents, unassignedStudents, totalApplications };
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
                  <div className="flex flex-wrap gap-3">
                    {changeAgentStudents.map(student => (
                      <Link key={student.id} href={`/student/${student.id}`}>
                        <Badge className="bg-black text-red-500 border-red-500 border-2 hover:bg-black/90 px-4 py-2 flex items-center gap-3 transition-transform hover:scale-105 group">
                          <div className="flex flex-col items-start leading-none">
                            <span className="font-black text-xs uppercase animate-pulse">{student.name}</span>
                            <span className="text-[8px] text-red-400 font-bold opacity-70">PRIORITY REVIEW</span>
                          </div>
                          <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Registered Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.totalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unassigned Leads</CardTitle>
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
                    <PersonalTodoList />
                </div>
            </div>
        </div>
    );
}
