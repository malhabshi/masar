'use client';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser } from '@/hooks/use-user';
import { Loader2 } from 'lucide-react';

export default function EmployeeActivityPage() {
    const { user: currentUser, isUserLoading } = useUser();
    
    if (isUserLoading) {
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
                    This feature is coming soon. This page will show reports on employee activity, such as tasks sent, student profiles visited, and time logged.
                </CardDescription>
            </CardHeader>
        </Card>
    );
}
