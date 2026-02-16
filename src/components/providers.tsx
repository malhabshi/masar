'use client';

import { UserProvider } from '@/hooks/use-user';
import { UsersProvider } from '@/contexts/users-provider';
import { FirebaseClientProvider } from '@/firebase';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <FirebaseClientProvider>
            <UserProvider>
                <UsersProvider>
                    {children}
                </UsersProvider>
            </UserProvider>
        </FirebaseClientProvider>
    );
}
