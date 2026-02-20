
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { timeLogs } from '@/lib/data';
import { EmployeeActivityTable } from '@/components/dashboard/employee-activity-table';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function EmployeeActivityPage() {
    const { user, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();

    if (isUserLoading || usersLoading) {
        return <div className="flex h-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (user?.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Permission Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Employee Activity</CardTitle>
                <CardDescription>A log of employee clock-ins and clock-outs.</CardDescription>
            </CardHeader>
            <CardContent>
                <EmployeeActivityTable timeLogs={timeLogs} users={users} />
            </CardContent>
        </Card>
    );
}
