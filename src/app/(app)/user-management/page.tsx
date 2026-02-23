'use client';

import { useUser } from '@/hooks/use-user';
import { CreateUserForm } from '@/components/user-management/create-user-form';
import { UserList } from '@/components/user-management/user-list';
import { BulkTransferForm } from '@/components/user-management/bulk-transfer-form';
import { Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

function UserManagementContent() {
    const { user: currentUser, isUserLoading: isCurrentUserLoading } = useUser();

    if (isCurrentUserLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (currentUser?.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have the required permissions to manage users.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-start">
            <div className="md:col-span-2 space-y-6">
                <UserList currentUser={currentUser} />
            </div>
            <div className="space-y-6">
                <CreateUserForm />
                <BulkTransferForm currentUser={currentUser} />
            </div>
        </div>
    );
}

export default function UserManagementPage() {
    return <UserManagementContent />;
}
