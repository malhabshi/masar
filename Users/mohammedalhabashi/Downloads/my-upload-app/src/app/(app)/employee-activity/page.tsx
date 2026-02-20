'use client';
import { useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { useFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import type { TimeLog } from '@/lib/types';
import { EmployeeActivityTable } from '@/components/dashboard/employee-activity-table';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function EmployeeActivityPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();
    const { firestore } = useFirebase();

    const timeLogsCollection = useMemo(() => !firestore ? null : collection(firestore, 'time_logs'), [firestore]);
    const { data: timeLogs, isLoading: timeLogsLoading } = useCollection<TimeLog>(timeLogsCollection);
    
    const isLoading = isUserLoading || usersLoading || timeLogsLoading;
    
    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    if (currentUser?.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have the required permissions to view employee activity.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Employee Activity</CardTitle>
                <CardDescription>
                    A log of all employee clock-in and clock-out times.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <EmployeeActivityTable timeLogs={timeLogs || []} users={users} />
                {(timeLogs || []).length === 0 && (
                    <p className="text-center text-muted-foreground py-10">No time log data found.</p>
                )}
            </CardContent>
        </Card>
    );
}
