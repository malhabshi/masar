'use client';

import { UserProvider } from '@/hooks/use-user';
import { UsersProvider } from '@/contexts/users-provider';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <UserProvider>
            <UsersProvider>
                {children}
                <FirebaseErrorListener />
            </UsersProvider>
        </UserProvider>
    );
}
