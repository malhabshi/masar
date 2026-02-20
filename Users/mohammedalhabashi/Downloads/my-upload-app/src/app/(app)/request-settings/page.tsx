'use client';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useUser } from '@/hooks/use-user';
import { Loader2 } from 'lucide-react';

export default function RequestSettingsPage() {
    const { user: currentUser, isUserLoading } = useUser();
    
    if (isUserLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    if (currentUser?.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have the required permissions to manage request settings.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Request Settings</CardTitle>
                <CardDescription>
                    This feature is coming soon. Here you will be able to manage the types of requests employees can make (e.g., "Request Transfer", "Report Inactivity").
                </CardDescription>
            </CardHeader>
        </Card>
    );
}
