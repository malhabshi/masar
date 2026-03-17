
'use client';

import { useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { orderBy, where } from 'firebase/firestore';
import type { Student, Task, User } from '@/lib/types';
import { Users, FileText, UserPlus, AlertCircle, ArrowRight, ShieldAlert, CheckCircle2, History } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';
import Link from 'next/link';

// Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import type { AppUser } from '@/hooks/use-user';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function AdminDashboard({ currentUser }: { currentUser: AppUser }) {
  const isAdmin = currentUser?.role === 'admin';
  const studentsPath = isAdmin ? 'students' : '';
  const tasksPath = currentUser ? 'tasks' : '';
  const usersPath = isAdmin ? 'users' : '';

  const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsPath);
  const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(tasksPath);
  const { data: usersData, isLoading: usersLoading } = useCollection<User>(usersPath);

  const students = useMemo(() => studentsData || [], [studentsData]);
  const tasks = useMemo(() => tasksData || [], [tasksData]);
  const users = useMemo(() => usersData || [], [usersData]);
  
  const isLoading = studentsLoading || tasksLoading || usersLoading;

  const changeAgentStudents = useMemo(() => {
    return students.filter(s => s.changeAgentRequired);
  }, [students]);

  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a,b) => sortByDate(a,b));
  }, [tasks]);

  const stats = useMemo(() => {
    if (!students) return { total: 0, assigned: 0, unassigned: 0, ghost: 0, totalApps: 0 };
    
    const validCivilIds = new Set(users.filter(u => u.role === 'employee' || u.role === 'department').map(u => u.civilId).filter(Boolean));
    const validUserIds = new Set(users.map(u => u.id));

    let assigned = 0;
    let unassigned = 0;
    let ghost = 0;

    students.forEach(s => {
      if (!s.employeeId) {
        unassigned++;
      } else if (validCivilIds.has(s.employeeId) || validUserIds.has(s.employeeId)) {
        assigned++;
      } else {
        ghost++;
      }
    });

    const totalApps = students.reduce((acc, s) => {
      // Only count apps for valid (non-ghost) students
      const isGhost = s.employeeId && !validCivilIds.has(s.employeeId) && !validUserIds.has(s.employeeId);
      if (isGhost) return acc;
      return acc + (s.applications?.length || 0);
    }, 0);
    
    // Total Registered excludes "Ghost" students who were assigned to employees that no longer exist
    const total = assigned + unassigned;
    
    return { total, assigned, unassigned, ghost, totalApps };
  }, [students, users]);

  if (!isAdmin) return null;

  return (
    <div className="space-y-6">
        {stats.ghost > 0 && (
          <Alert variant="destructive" className="border-2 border-red-600 bg-red-50">
            <ShieldAlert className="h-5 w-5" />
            <div className="flex-1">
              <AlertTitle className="font-black uppercase tracking-tighter">🚨 DATA INTEGRITY WARNING</AlertTitle>
              <AlertDescription className="text-red-800 font-medium">
                Found <strong>{stats.ghost}</strong> students assigned to invalid or deleted IDs. These students are excluded from active totals and hidden from all employees.
                <Link href="/user-management" className="ml-2 underline font-bold">Fix using Bulk Transfer &rarr;</Link>
              </AlertDescription>
            </div>
          </Alert>
        )}

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
                        <span className="text-[8px] text-red-400 font-bold opacity-70">URGENT REVIEW</span>
                      </div>
                      <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            <Card className="border-primary/20">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Total Registered</CardTitle>
                    <Users className="h-4 w-4 text-primary" />
                </CardHeader>
                <CardContent>
                    <div className="text-3xl font-black">{isLoading ? '...' : stats.total}</div>
                    <div className="flex items-center gap-1 mt-1">
                      <Badge variant="outline" className="text-[9px] h-4 bg-primary/5 text-primary border-primary/20">Active Students</Badge>
                    </div>
                </CardContent>
            </Card>
            <Card className="border-green-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs font-bold uppercase text-green-700 tracking-widest">Officially Assigned</CardTitle>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-3xl font-black text-green-700">{isLoading ? '...' : stats.assigned}</div>
                    <p className="text-[10px] text-green-600 font-medium mt-1">Active in employee portfolios.</p>
                </CardContent>
            </Card>
            <Card className="border-orange-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs font-bold uppercase text-orange-700 tracking-widest">Unassigned Leads</CardTitle>
                    <UserPlus className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-3xl font-black text-orange-700">{isLoading ? '...' : stats.unassigned}</div>
                    <p className="text-[10px] text-orange-600 font-medium mt-1">Pending official assignment.</p>
                </CardContent>
            </Card>
            <Card className="border-blue-200">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-xs font-bold uppercase text-blue-700 tracking-widest">Total Applications</CardTitle>
                    <FileText className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                    <div className="text-3xl font-black text-blue-700">{isLoading ? '...' : stats.totalApps}</div>
                    <p className="text-[10px] text-blue-600 font-medium mt-1">Active university requests.</p>
                </CardContent>
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
