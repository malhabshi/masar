'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, Task, User } from '@/lib/types';
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
     const [isClient, setIsClient] = useState(false);

     useEffect(() => {
       setIsClient(true);
     }, []);
     
     const studentsPath = (isClient && isDept) ? 'students' : '';
     const usersPath = (isClient && isDept) ? 'users' : '';

     const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsPath);
     const { data: usersData, isLoading: usersLoading } = useCollection<User>(usersPath);

     const taskQuery = useMemoFirebase(() => {
        if (!currentUser || !isDept || !isClient) return null;
        
        if (isAdmin) {
            return query(collection(firestore, 'tasks'));
        }

        const groups = [currentUser.id, 'all'];
        if (currentUser.department) {
            groups.push(`dept:${currentUser.department}`);
        }

        return query(
            collection(firestore, 'tasks'), 
            where('recipientIds', 'array-contains-any', groups)
        );
     }, [currentUser, isDept, isAdmin, isClient]);

     const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(taskQuery);
     
     const students = useMemo(() => studentsData || [], [studentsData]);
     const tasks = useMemo(() => tasksData || [], [tasksData]);
     const users = useMemo(() => usersData || [], [usersData]);

     const isLoading = studentsLoading || tasksLoading || usersLoading;

     const changeAgentStudents = useMemo(() => {
        return students.filter(s => s.changeAgentRequired);
     }, [students]);

     const sortedTasks = useMemo(() => {
        return [...tasks].sort((a,b) => sortByDate(a,b));
    }, [tasks]);

     const stats = useMemo(() => {
        if(!students || !users) return { 
          totalStudents: 0, 
          unassignedStudents: 0, 
          apps: { total: 0, pending: 0, submitted: 0, inReview: 0, accepted: 0, rejected: 0 } 
        };
        
        const validCivilIds = new Set(users.map(u => u.civilId).filter(Boolean));
        const validUserIds = new Set(users.map(u => u.id));
        
        const apps = { total: 0, pending: 0, submitted: 0, inReview: 0, accepted: 0, rejected: 0 };
        let totalStudents = 0;
        let unassignedStudents = 0;

        students.forEach(s => {
            const hasAgent = !!s.employeeId;
            const isGhost = hasAgent && !validCivilIds.has(s.employeeId!) && !validUserIds.has(s.employeeId!);
            
            if (isGhost) return;

            totalStudents++;
            if (!hasAgent) unassignedStudents++;

            (s.applications || []).forEach(app => {
                apps.total++;
                const status = app.status;
                if (status === 'Pending') apps.pending++;
                else if (status === 'Submitted') apps.submitted++;
                else if (status === 'In Review') apps.inReview++;
                else if (status === 'Accepted') apps.accepted++;
                else if (status === 'Rejected') apps.rejected++;
            });
        });
        
        return { totalStudents, unassignedStudents, apps };
    }, [students, users]);

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
                <Card className="border-blue-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
                        <FileText className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-700 mb-3">{isLoading ? '...' : stats.apps.total}</div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] bg-muted/50 px-2 py-1 rounded">
                            <span className="text-muted-foreground uppercase font-bold">Pending</span>
                            <span className="font-black text-yellow-600">{stats.apps.pending}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-muted/50 px-2 py-1 rounded">
                            <span className="text-muted-foreground uppercase font-bold">Submitted</span>
                            <span className="font-black text-blue-600">{stats.apps.submitted}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-muted/50 px-2 py-1 rounded">
                            <span className="text-muted-foreground uppercase font-bold">In Review</span>
                            <span className="font-black text-purple-600">{stats.apps.inReview}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-green-50 px-2 py-1 rounded">
                            <span className="text-red-700 uppercase font-bold">Accepted</span>
                            <span className="font-black text-green-700">{stats.apps.accepted}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-red-50 px-2 py-1 rounded">
                            <span className="text-red-700 uppercase font-bold">Rejected</span>
                            <span className="font-black text-red-700">{stats.apps.rejected}</span>
                          </div>
                        </div>
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
