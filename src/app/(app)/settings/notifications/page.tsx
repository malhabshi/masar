
'use client';

import { useUser } from '@/hooks/use-user';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { NotificationTemplatesManager } from '@/components/settings/notification-templates-manager';

export default function NotificationTemplatesPage() {
    const { user: currentUser, isUserLoading } = useUser();

    if (isUserLoading) {
        return <div className="flex h-full w-full items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (currentUser?.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to manage notification templates.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return <NotificationTemplatesManager currentUser={currentUser} />;
}
