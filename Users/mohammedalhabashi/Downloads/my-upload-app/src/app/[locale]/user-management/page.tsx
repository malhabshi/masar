
'use client';

import { useUser, UserProvider } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { CreateUserForm } from '@/components/user-management/create-user-form';
import { UserList } from '@/components/user-management/user-list';
import { BulkTransferForm } from '@/components/user-management/bulk-transfer-form';
import { Loader2 } from 'lucide-react';
import type { UserRole } from '@/lib/types';
import { useFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

function UserManagementContent() {
    const { user, updateUserRole, isUserLoading: isCurrentUserLoading } = useUser();
    const { users, usersLoading } = useUsers();
    const { firestore } = useFirebase();

    const handleUpdateUserRole = async (userId: string, newRole: UserRole) => {
        if (!firestore) return;
        const userDocRef = doc(firestore, 'users', userId);
        await updateDoc(userDocRef, { role: newRole });
    };
    
    if (isCurrentUserLoading || usersLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (user?.role !== 'admin') {
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
                <UserList users={users} currentUser={user} onUpdateUserRole={handleUpdateUserRole} />
            </div>
            <div className="space-y-6">
                <CreateUserForm />
                <BulkTransferForm employees={users} currentUser={user} />
            </div>
        </div>
    );
}


export default function UserManagementPage() {
    return <UserManagementContent />;
}
