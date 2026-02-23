'use client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Users, University } from 'lucide-react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Student, Application } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { useUsers } from '@/hooks/use-users';
import dynamic from 'next/dynamic';
import { firestore } from '@/firebase';

// Lazy load the recharts components
const ResponsiveContainer = dynamic(
    () => import('recharts').then((mod) => mod.ResponsiveContainer),
    { ssr: false, loading: () => <div className="h-[300px] w-full animate-pulse bg-muted rounded-lg" /> }
);
const RechartsBarChart = dynamic(
    () => import('recharts').then((mod) => mod.BarChart),
    { ssr: false, loading: () => <div className="h-[300px] w-full animate-pulse bg-muted rounded-lg" /> }
);
const XAxis = dynamic(() => import('recharts').then((mod) => mod.XAxis), { ssr: false });
const YAxis = dynamic(() => import('recharts').then((mod) => mod.YAxis), { ssr: false });
const Tooltip = dynamic(() => import('recharts').then((mod) => mod.Tooltip), { ssr: false });
const Bar = dynamic(() => import('recharts').then((mod) => mod.Bar), { ssr: false });


export default function ReportsPage() {
    const { users, usersLoading } = useUsers();
    
    const studentsCollection = useMemoFirebase(() => collection(firestore, 'students'), []);
    const { data: students, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    
    const applications: Application[] = useMemo(() => students?.flatMap(s => s.applications || []) || [], [students]);
    
    const isLoading = usersLoading || studentsLoading;

    const totalStudents = useMemo(() => students?.length || 0, [students]);
    const totalApplications = useMemo(() => applications.length, [applications]);
    const totalEmployees = useMemo(() => users?.filter(u => u.role === 'employee').length || 0, [users]);

    const applicationStatusData = useMemo(() => {
        const counts = applications.reduce((acc, app) => {
            acc[app.status] = (acc[app.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        return Object.entries(counts).map(([name, value]) => ({ name, count: value }));
    }, [applications]);

    const studentEmployeeData = useMemo(() => {
        if (!users) return [];
        const employeeMap = new Map<string, string>();
        users.forEach(u => u.civilId && employeeMap.set(u.civilId, u.name));

        const counts = (students || []).reduce((acc, student) => {
            const employeeName = student.employeeId ? (employeeMap.get(student.employeeId) || 'Unassigned') : 'Unassigned';
            acc[employeeName] = (acc[employeeName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return Object.entries(counts).map(([name, value]) => ({ name, count: value }));
    }, [students, users]);

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
                        <University className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalApplications}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalEmployees}</div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Application Status Overview</CardTitle>
                        <CardDescription>Distribution of application statuses across all students.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <RechartsBarChart data={applicationStatusData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false}/>
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} />
                                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </RechartsBarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle>Students per Employee</CardTitle>
                        <CardDescription>Number of students assigned to each employee.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <RechartsBarChart data={studentEmployeeData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false}/>
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} />
                                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                            </RechartsBarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
