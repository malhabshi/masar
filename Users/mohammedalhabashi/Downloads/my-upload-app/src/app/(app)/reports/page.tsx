'use client';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Users, University } from 'lucide-react';
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
    
    const applications: Application[] = useMemo(() => students?.flatMap(s => s.applications || []) || [], [students]);
    
    const isLoading = usersLoading || studentsLoading;

    const totalStudents = students?.length || 0;
    const totalApplications = applications.length;
    const totalEmployees = users.filter(u => u.role === 'employee').length || 0;

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

            <Card>
                <CardHeader>
                    <CardTitle>Reporting Charts</CardTitle>
                    <CardDescription>Charts will be re-enabled once the build issues are fully resolved.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">The application status and students-per-employee charts have been temporarily disabled to resolve a critical build error.</p>
                </CardContent>
            </Card>
        </div>
    )
}
