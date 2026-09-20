'use client';

import { useMemo, useState, useEffect } from 'react';
import { useCollection } from '@/firebase/client';
import type { Student, Task, User } from '@/lib/types';
import { Users, FileText, UserPlus, AlertCircle, ArrowRight, CheckCircle2, LayoutGrid } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';
import Link from 'next/link';

// Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { where } from 'firebase/firestore';
import { TaskList } from '@/components/dashboard/task-list';
import { getAdminDashboardStats, type AdminDashboardStats } from '@/lib/actions';
import { RequestUpdatesCard } from '@/components/dashboard/request-updates-card';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import type { AppUser } from '@/hooks/use-user';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { DashboardRemindersCard } from '@/components/dashboard/dashboard-reminders-card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export default function AdminDashboard({ currentUser }: { currentUser: AppUser }) {
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'adminplus';
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  // Only the students that are actually shown as badges. The counters come from
  // getAdminDashboardStats instead of downloading all 1,960 records.
  const studentsPath = (isClient && isAdmin) ? 'students' : '';
  const tasksPath = (isClient && currentUser) ? 'tasks' : '';
  const usersPath = (isClient && isAdmin) ? 'users' : '';

  const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(
    studentsPath, where('changeAgentRequired', '==', true),
  );

  // Counters computed server-side — see getAdminDashboardStats.
  const [serverStats, setServerStats] = useState<AdminDashboardStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  useEffect(() => {
    if (!isClient || !currentUser?.id) return;
    let cancelled = false;
    setStatsLoading(true);
    getAdminDashboardStats(currentUser.id).then(res => {
      if (cancelled) return;
      setServerStats(res);
      setStatsLoading(false);
    });
    return () => { cancelled = true; };
  }, [isClient, currentUser?.id]);
  // TaskList renders ONLY category 'update' notes written by management — 15 documents
  // in the whole system. This used to fetch the entire tasks collection instead: 26,806
  // documents, 13.5 MB, on every dashboard load.
  const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(
    tasksPath, where('category', '==', 'update'),
  );
  const { data: usersData, isLoading: usersLoading } = useCollection<User>(usersPath);

  const students = useMemo(() => studentsData || [], [studentsData]);
  const tasks = useMemo(() => tasksData || [], [tasksData]);
  const users = useMemo(() => usersData || [], [usersData]);
  
  const isLoading = statsLoading || tasksLoading;

  const changeAgentStudents = useMemo(() => {
    return students.filter(s => s.changeAgentRequired);
  }, [students]);

  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    return [...tasks].sort((a,b) => sortByDate(a,b));
  }, [tasks]);

  // Counters come from the server now — see getAdminDashboardStats. The browser used
  // to download all 1,960 students (9.7 MB) purely to add them up.
  const EMPTY_STATS: AdminDashboardStats = {
    total: 0, assigned: 0, unassigned: 0,
    apps: { total: 0, pending: 0, submitted: 0, missingItems: 0, accepted: 0, rejected: 0 },
    pipeline: { green: 0, yellow: 0, orange: 0, red: 0, black: 0, none: 0 },
    agentBreakdown: [],
  };
  const stats = serverStats ?? EMPTY_STATS;

  // Per-User Portfolio Breakdown - Includes all staff who have students assigned
  const agentBreakdown = useMemo(
    () => [...stats.agentBreakdown].sort((a, b) => b.total - a.total),
    [stats.agentBreakdown],
  );

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
          <Card>
            <CardHeader className="pb-3 border-b bg-muted/5">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Portfolio Performance Breakdown</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30">
                      <TableHead className="text-[10px] font-black uppercase">Staff Member</TableHead>
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
                        <TableCell className="font-bold text-xs">
                          {agent.name}
                          {agent.role !== 'employee' && (
                            <Badge variant="outline" className="ml-2 text-[8px] uppercase h-4 px-1">{agent.role}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className="font-mono text-[10px]">{agent.total}</Badge></TableCell>
                        <TableCell className="text-center font-black text-green-700 text-xs">{agent.green}</TableCell>
                        <TableCell className="text-center font-black text-orange-700 text-xs">{agent.orange}</TableCell>
                        <TableCell className="text-center font-black text-red-700 text-xs">{agent.red}</TableCell>
                        <TableCell className="text-center font-bold text-muted-foreground text-xs">{agent.none}</TableCell>
                      </TableRow>
                    ))}
                    {agentBreakdown.length === 0 && !isLoading && (
                      <TableRow>
                        <TableCell colSpan={6} className="h-20 text-center text-xs text-muted-foreground italic">No students assigned to any active staff yet.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <SendTaskForm currentUser={currentUser} />
          <RequestUpdatesCard currentUser={currentUser} />
          <TaskList tasks={sortedTasks} currentUser={currentUser} isLoading={isLoading} />
        </div>
        <div className="space-y-6">
          <DashboardRemindersCard currentUser={currentUser} />
          <UpcomingEventsCard />
          <PersonalTodoList />
        </div>
      </div>
    </div>
  );
}
