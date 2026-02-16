'use client';

import { useUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Users, FileText, CheckCircle, UserPlus, Loader2 } from 'lucide-react';
import { SendTaskForm } from '@/components/dashboard/send-task-form';
import { TaskList } from '@/components/dashboard/task-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, getDocs, doc, getDoc, documentId, orderBy, limit } from 'firebase/firestore';
import type { Student, Task, User } from '@/lib/types';
import { useMemo, useState, useEffect } from 'react';
import { useUsers } from '@/contexts/users-provider';

function AdminDepartmentDashboard({ user, users }: { user: User, users: User[] }) {
    const { firestore } = useFirebase();

    const studentsCollection = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'students');
    }, [firestore]);
    const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    const students = useMemo(() => studentsData || [], [studentsData]);
    
    // Fetch only the 20 most recent tasks for admin/dept roles.
    const tasksCollection = useMemoFirebase(() => {
        if (!firestore) return null;
        return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'), limit(20));
    }, [firestore]);

    const { data: allTasksData, isLoading: tasksLoading } = useCollection<Task>(tasksCollection);
    
    // Filter tasks on the client-side to show only relevant received tasks on the dashboard.
    const myTasks = useMemo(() => {
      if (!allTasksData) return [];

      const recipientFilters = ['all', user.id];
      if (user.role === 'admin') recipientFilters.push('admins');
      if (user.role === 'department') recipientFilters.push('departments');
      
      return allTasksData
        .filter(task => recipientFilters.includes(task.recipientId))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [allTasksData, user.id, user.role]);


    if (studentsLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const totalStudents = students.length;
    const pendingApplications = students.reduce((acc, s) => acc + s.applications.filter(a => a.status === 'Pending' || a.status === 'Submitted' || a.status === 'In Review').length, 0);
    const totalEmployees = users.filter(u => u.role === 'employee').length;
    const unassignedStudentsCount = students.filter(s => !s.employeeId).length;

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="hover:bg-muted/50 transition-colors"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total Students</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{totalStudents}</div></CardContent></Card>
                <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Pending Applications</CardTitle><FileText className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{pendingApplications}</div></CardContent></Card>
                <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Active Employees</CardTitle><CheckCircle className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{totalEmployees}</div></CardContent></Card>
                <Card className="hover:bg-muted/50 transition-colors"><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Unassigned Students</CardTitle><UserPlus className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{unassignedStudentsCount}</div></CardContent></Card>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
                <div className="md:col-span-2"><TaskList tasks={myTasks} users={users} currentUser={user} isLoading={tasksLoading} /></div>
                <UpcomingEventsCard currentUser={user} />
                <SendTaskForm currentUser={user} recipients={users.filter(u => u.id !== user.id)} />
                <div className="md:col-span-2"><PersonalTodoList /></div>
            </div>
        </div>
    );
}

function EmployeeDashboard({ user, users }: { user: User, users: User[] }) {
    const { firestore } = useFirebase();

    // Fetch students assigned to this employee directly.
    const employeeStudentsQuery = useMemoFirebase(() => {
        if (!firestore || !user.civilId) return null;
        return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }, [firestore, user.civilId]);

    const { data: employeeStudents, isLoading: studentsLoading } = useCollection<Student>(employeeStudentsQuery);
    
    // Fetch only the 20 most recent relevant tasks for the employee.
    const employeeTasksQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return query(collection(firestore, 'tasks'), where('recipientId', 'in', [user.id, 'all']), orderBy('createdAt', 'desc'), limit(20));
    }, [firestore, user.id]);

    const { data: myTasks, isLoading: tasksLoading } = useCollection<Task>(employeeTasksQuery);
    
    const sortedTasks = useMemo(() => {
        if (!myTasks) return [];
        return myTasks.sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [myTasks]);


    if (studentsLoading) {
        return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    const myStudents = employeeStudents || [];
    const pendingApplications = myStudents.reduce((acc, s) => acc + s.applications.filter(a => a.status === 'Pending' || a.status === 'Submitted' || a.status === 'In Review').length, 0);
    
    return (
        <div className="space-y-6">
            <div className="flex justify-between items-start">
                <div>
                    <h2 className="text-2xl font-semibold">Welcome, {user.name}!</h2>
                    <p className="text-muted-foreground">Here is a summary of your assigned students and recent tasks.</p>
                </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
                <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">My Students</CardTitle><Users className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{myStudents.length}</div></CardContent></Card>
                <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Pending Applications</CardTitle><FileText className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{pendingApplications}</div></CardContent></Card>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
                <TaskList tasks={sortedTasks} users={users} currentUser={user} isLoading={tasksLoading} />
                <UpcomingEventsCard currentUser={user} />
                <div className="lg:col-span-2"><PersonalTodoList /></div>
            </div>
        </div>
    );
}

export default function DashboardPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();

  if (isUserLoading || usersLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (!user) {
    return <div className="flex items-center justify-center h-full"><p>Please log in to view this page.</p></div>;
  }

  if (['admin', 'department'].includes(user.role)) {
    return <AdminDepartmentDashboard user={user} users={users} />;
  }
  
  return <EmployeeDashboard user={user} users={users} />;
}
