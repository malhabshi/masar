'use client';

import { UserProvider } from '@/hooks/use-user';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <UserProvider>
            {children}
            <FirebaseErrorListener />
        </UserProvider>
    );
}
