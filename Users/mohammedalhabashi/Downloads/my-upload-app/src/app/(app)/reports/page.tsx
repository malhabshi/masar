'use client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Users, University, UserPlus, GraduationCap } from 'lucide-react';
import { useFirebase, useCollection } from '@/firebase';
import { useUsers } from '@/contexts/users-provider';
import { collection } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Student, Application } from '@/lib/types';
import { Loader2 } from 'lucide-react';

export default function ReportsPage() {
    const { firestore } = useFirebase();
    const { users, usersLoading } = useUsers();
    
    const studentsCollection = useMemo(() => !firestore ? null : collection(firestore, 'students'), [firestore]);
    const { data: students, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    
    const isLoading = usersLoading || studentsLoading;

    const stats = useMemo(() => {
        if (!students) return {
            totalStudents: 0,
            totalApplications: 0,
            totalEmployees: 0,
            unassignedStudents: 0,
            finalizedStudents: 0,
        };

        const applications: Application[] = students.flatMap(s => s.applications || []);
        
        return {
            totalStudents: students.length,
            totalApplications: applications.length,
            totalEmployees: users.filter(u => u.role === 'employee').length,
            unassignedStudents: students.filter(s => !s.employeeId).length,
            finalizedStudents: students.filter(s => s.finalChoiceUniversity).length,
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
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Applications</CardTitle>
                        <University className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalApplications}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unassigned Students</CardTitle>
                        <UserPlus className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.unassignedStudents}</div>
                    </CardContent>
                </Card>
                 <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Finalized Students</CardTitle>
                        <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.finalizedStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Employees</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.totalEmployees}</div>
                    </CardContent>
                </Card>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle>More Reports Coming Soon</CardTitle>
                    <CardDescription>Charts and more detailed breakdowns will be added back shortly.</CardDescription>
                </CardHeader>
            </Card>
        </div>
    )
}
