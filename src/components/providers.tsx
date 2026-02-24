'use client';

import { UserProvider } from '@/hooks/use-user';
import { UsersProvider } from '@/contexts/users-provider';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';
import { ErrorBoundary } from './error-boundary';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <ErrorBoundary>
            <UserProvider>
                <UsersProvider>
                    {children}
                    <FirebaseErrorListener />
                </UsersProvider>
            </UserProvider>
        </ErrorBoundary>
    );
}
