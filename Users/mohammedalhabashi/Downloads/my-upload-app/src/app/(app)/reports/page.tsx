'use client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Users, University, UserPlus, GraduationCap } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { useFirebase, useCollection } from '@/firebase';
import { useUsers } from '@/contexts/users-provider';
import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Student, Application, ApplicationStatus } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export default function ReportsPage() {
    const { firestore } = useFirebase();
    const { users, usersLoading } = useUsers();
    
    const studentsCollection = useMemo(() => !firestore ? null : collection(firestore, 'students'), [firestore]);
    const { data: students, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    
    const isLoading = usersLoading || studentsLoading;

    const {
        totalStudents,
        totalApplications,
        unassignedStudents,
        finalizedStudents,
        totalEmployees,
        applicationStatusData,
        studentEmployeeData
    } = useMemo(() => {
        if (!students || !users) return {
            totalStudents: 0,
            totalApplications: 0,
            unassignedStudents: 0,
            finalizedStudents: 0,
            totalEmployees: 0,
            applicationStatusData: [],
            studentEmployeeData: [],
        };

        const applications: Application[] = students.flatMap(s => s.applications || []);
        
        const statusCounts = applications.reduce((acc, app) => {
            acc[app.status] = (acc[app.status] || 0) + 1;
            return acc;
        }, {} as Record<ApplicationStatus, number>);

        const applicationStatusData = Object.entries(statusCounts).map(([name, count]) => ({ name, count }));

        const employeeMap = new Map<string, string>();
        users.forEach(u => u.civilId && employeeMap.set(u.civilId, u.name));

        const studentCounts = students.reduce((acc, student) => {
            const employeeName = student.employeeId ? (employeeMap.get(student.employeeId) || 'Unassigned') : 'Unassigned';
            acc[employeeName] = (acc[employeeName] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const studentEmployeeData = Object.entries(studentCounts).map(([name, count]) => ({ name, count }));
        
        return {
            totalStudents: students.length,
            totalApplications: applications.length,
            totalEmployees: users.filter(u => u.role === 'employee').length,
            unassignedStudents: students.filter(s => !s.employeeId).length,
            finalizedStudents: students.filter(s => s.finalChoiceUniversity).length,
            applicationStatusData,
            studentEmployeeData,
        };
    }, [students, users]);

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    return (
        <div className="space-y-6">
             <CardHeader className="px-0">
                <CardTitle>Reports</CardTitle>
                <CardDescription>An overview of key metrics across the application.</CardDescription>
            </CardHeader>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-5">
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
                        <CardTitle className="text-sm font-medium">Unassigned Students</CardTitle>
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{unassignedStudents}</div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Finalized Students</CardTitle>
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{finalizedStudents}</div>
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
                            <BarChart data={applicationStatusData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false}/>
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{backgroundColor: 'hsl(var(--background))'}}/>
                                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                            </BarChart>
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
                            <BarChart data={studentEmployeeData}>
                                <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false}/>
                                <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip cursor={{fill: 'hsl(var(--muted))'}} contentStyle={{backgroundColor: 'hsl(var(--background))'}} />
                                <Bar dataKey="count" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
