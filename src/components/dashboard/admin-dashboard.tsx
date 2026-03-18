'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection } from '@/firebase/client';
import type { Student, Task, User } from '@/lib/types';
import { Users, FileText, UserPlus, AlertCircle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
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

export default function AdminDashboard({ currentUser }: { currentUser: AppUser }) {
  const isAdmin = currentUser?.role === 'admin';
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const studentsPath = (isClient && isAdmin) ? 'students' : '';
  const tasksPath = (isClient && currentUser) ? 'tasks' : '';
  const usersPath = (isClient && isAdmin) ? 'users' : '';

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
    if (!students || !users) return { 
      total: 0, 
      assigned: 0, 
      unassigned: 0, 
      ghost: 0, 
      apps: { total: 0, pending: 0, submitted: 0, missingItems: 0, accepted: 0, rejected: 0 },
      pipeline: { green: 0, orange: 0, red: 0, none: 0 }
    };
    
    const validCivilIds = new Set(users.map(u => u.civilId).filter(Boolean));
    const validUserIds = new Set(users.map(u => u.id));

    let assigned = 0;
    let unassigned = 0;
    let ghost = 0;
    const apps = { total: 0, pending: 0, submitted: 0, missingItems: 0, accepted: 0, rejected: 0 };
    const pipeline = { green: 0, orange: 0, red: 0, none: 0 };

    students.forEach(s => {
      const hasAgent = !!s.employeeId;
      const isGhost = hasAgent && !validCivilIds.has(s.employeeId!) && !validUserIds.has(s.employeeId!);
      
      if (!hasAgent) {
        unassigned++;
      } else if (!isGhost) {
        assigned++;
        // Count pipeline status for assigned students
        const status = s.pipelineStatus || 'none';
        if (status === 'green') pipeline.green++;
        else if (status === 'orange') pipeline.orange++;
        else if (status === 'red') pipeline.red++;
        else pipeline.none++;
      } else {
        ghost++;
      }

      // Stats Breakdown (Exclude ghosts from official metrics)
      if (!isGhost) {
        (s.applications || []).forEach(app => {
          apps.total++;
          const status = app.status;
          if (status === 'Pending') apps.pending++;
          else if (status === 'Submitted') apps.submitted++;
          else if (status === 'Missing Items') apps.missingItems++;
          else if (status === 'Accepted') apps.accepted++;
          else if (status === 'Rejected') apps.rejected++;
        });
      }
    });
    
    const total = assigned + unassigned;
    return { total, assigned, unassigned, ghost, apps, pipeline };
  }, [students, users]);

  if (!isAdmin) return null;

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
            <div className="text-3xl font-black text-green-700 mb-3">{isLoading ? '...' : stats.assigned}</div>
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

        <Card className="border-orange-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-orange-700 tracking-widest">Unassigned Leads</CardTitle>
            <UserPlus className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-orange-700">{isLoading ? '...' : stats.unassigned}</div>
            <p className="text-[10px] text-orange-600 font-medium mt-1">Pending assignment.</p>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase text-blue-700 tracking-widest">Total Applications</CardTitle>
            <FileText className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-black text-blue-700 mb-3">{isLoading ? '...' : stats.apps.total}</div>
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
