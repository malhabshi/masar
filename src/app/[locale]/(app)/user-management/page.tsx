
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { CreateUserForm } from '@/components/user-management/create-user-form';
import { UserList } from '@/components/user-management/user-list';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BulkTransferForm } from '@/components/user-management/bulk-transfer-form';
import { Loader2 } from 'lucide-react';

export default function UserManagementPage() {
    const { user, updateUserRole, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();

    if (isUserLoading || usersLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    if (!user || user.role !== 'admin') {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="grid md:grid-cols-3 gap-6">
            <div className="md:col-span-1 space-y-6">
                <CreateUserForm />
                <BulkTransferForm employees={users} currentUser={user} />
            </div>
            <div className="md:col-span-2">
                <Card>
                    <CardHeader>
                        <CardTitle>Existing Users</CardTitle>
                        <CardDescription>A list of all users in the system.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <UserList users={users} currentUser={user} onUpdateUserRole={updateUserRole} />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
