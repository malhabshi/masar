'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, Task, User } from '@/lib/types';
import { Users, FileText, AlertCircle, ArrowRight, UserPlus, LayoutGrid } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

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
     
     const rawStudents = useMemo(() => studentsData || [], [studentsData]);
     const tasks = useMemo(() => tasksData || [], [tasksData]);
     const users = useMemo(() => usersData || [], [usersData]);

     // Filter students based on department region for departmental dashboard
     const students = useMemo(() => {
        if (!isDept || isAdmin) return rawStudents;
        const dept = currentUser.department;
        if (!dept) return rawStudents;

        return rawStudents.filter(s => {
            const appCountries = (s.applications || []).map(a => a.country);
            return (dept === 'UK' && appCountries.includes('UK')) || 
                   (dept === 'USA' && appCountries.includes('USA')) || 
                   (dept === 'AU/NZ' && (appCountries.includes('Australia') || appCountries.includes('New Zealand')));
        });
     }, [rawStudents, isDept, isAdmin, currentUser.department]);

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
          apps: { total: 0, pending: 0, submitted: 0, missingItems: 0, accepted: 0, rejected: 0 },
          pipeline: { green: 0, orange: 0, red: 0, none: 0 }
        };
        
        const validCivilIds = new Set(users.map(u => u.civilId).filter(Boolean));
        const validUserIds = new Set(users.map(u => u.id));
        
        const apps = { total: 0, pending: 0, submitted: 0, missingItems: 0, accepted: 0, rejected: 0 };
        const pipeline = { green: 0, orange: 0, red: 0, none: 0 };
        let totalStudents = 0;
        let unassignedStudents = 0;

        students.forEach(s => {
            const hasAgent = !!s.employeeId;
            const isGhost = hasAgent && !validCivilIds.has(s.employeeId!) && !validUserIds.has(s.employeeId!);
            
            if (isGhost) return;

            totalStudents++;
            if (!hasAgent) {
              unassignedStudents++;
            } else {
              // Count pipeline status for assigned students
              const status = s.pipelineStatus || 'none';
              if (status === 'green') pipeline.green++;
              else if (status === 'orange') pipeline.orange++;
              else if (status === 'red') pipeline.red++;
              else pipeline.none++;
            }

            (s.applications || []).forEach(app => {
                apps.total++;
                const status = app.status;
                if (status === 'Pending') apps.pending++;
                else if (status === 'Submitted') apps.submitted++;
                else if (status === 'Missing Items') apps.missingItems++;
                else if (status === 'Accepted') apps.accepted++;
                else if (status === 'Rejected') apps.rejected++;
            });
        });
        
        return { totalStudents, unassignedStudents, apps, pipeline };
    }, [students, users]);

    // Per-User Portfolio Breakdown (Filtered by Department)
    const agentBreakdown = useMemo(() => {
        if (!isClient || !users || !students) return [];

        const statsMap = new Map<string, { id: string, name: string, total: number, green: number, orange: number, red: number, none: number }>();
        
        users.forEach(u => {
            if (u.civilId) {
                statsMap.set(u.civilId, { id: u.id, name: u.name, total: 0, green: 0, orange: 0, red: 0, none: 0 });
            }
        });

        students.forEach(s => {
            if (s.employeeId && statsMap.has(s.employeeId)) {
                const entry = statsMap.get(s.employeeId)!;
                entry.total++;
                const status = s.pipelineStatus || 'none';
                if (status === 'green') entry.green++;
                else if (status === 'orange') entry.orange++;
                else if (status === 'red') entry.red++;
                else entry.none++;
            }
        });

        return Array.from(statsMap.values())
            .filter(s => s.total > 0)
            .sort((a, b) => b.total - a.total);
    }, [isClient, users, students]);

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
                <Card className="border-green-200">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Registered Students</CardTitle>
                        <Users className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-700 mb-3">{isLoading ? '...' : stats.totalStudents}</div>
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] bg-green-50 px-2 py-1 rounded">
                            <span className="text-green-700 uppercase font-bold">Green</span>
                            <span className="font-black text-green-700">{stats.pipeline.green}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-orange-50 px-2 py-1 rounded">
                            <span className="text-orange-700 uppercase font-bold">Orange</span>
                            <span className="font-black text-orange-700">{stats.pipeline.orange}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-red-50 px-2 py-1 rounded">
                            <span className="text-red-700 uppercase font-bold">Red</span>
                            <span className="font-black text-red-700">{stats.pipeline.red}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-muted/50 px-2 py-1 rounded">
                            <span className="text-muted-foreground uppercase font-bold">No Status</span>
                            <span className="font-black text-muted-foreground">{stats.pipeline.none}</span>
                          </div>
                        </div>
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
                            <span className="text-muted-foreground uppercase font-bold">Missing Items</span>
                            <span className="font-black text-purple-600">{stats.apps.missingItems}</span>
                          </div>
                          <div className="flex items-center justify-between text-[10px] bg-green-50 px-2 py-1 rounded">
                            <span className="text-green-700 uppercase font-bold">Accepted</span>
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
                    <Card>
                        <CardHeader className="pb-3 border-b bg-muted/5">
                            <div className="flex items-center gap-2">
                                <LayoutGrid className="h-4 w-4 text-primary" />
                                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Portfolio Performance ({currentUser.department || 'Region'})</CardTitle>
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow className="bg-muted/30">
                                            <TableHead className="text-[10px] font-black uppercase">Employee</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase text-center">Total</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase text-center text-green-700">Green</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase text-center text-orange-700">Orange</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase text-center text-red-700">Red</TableHead>
                                            <TableHead className="text-[10px] font-black uppercase text-center text-muted-foreground">None</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {agentBreakdown.map((agent) => (
                                            <TableRow key={agent.id}>
                                                <TableCell className="font-bold text-xs">{agent.name}</TableCell>
                                                <TableCell className="text-center"><Badge variant="outline" className="font-mono text-[10px]">{agent.total}</Badge></TableCell>
                                                <TableCell className="text-center font-black text-green-700 text-xs">{agent.green}</TableCell>
                                                <TableCell className="text-center font-black text-orange-700 text-xs">{agent.orange}</TableCell>
                                                <TableCell className="text-center font-black text-red-700 text-xs">{agent.red}</TableCell>
                                                <TableCell className="text-center font-bold text-muted-foreground text-xs">{agent.none}</TableCell>
                                            </TableRow>
                                        ))}
                                        {agentBreakdown.length === 0 && !isLoading && (
                                            <TableRow>
                                                <TableCell colSpan={6} className="h-20 text-center text-xs text-muted-foreground italic">No students assigned in this region yet.</TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>
                        </CardContent>
                    </Card>

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
