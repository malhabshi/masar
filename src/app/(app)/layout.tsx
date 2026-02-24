'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useHeartbeat } from '@/hooks/use-heartbeat';
import { AppSidebar } from '@/components/sidebar';
import { Loader2 } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { NotificationListener } from '@/components/notifications/notification-listener';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  console.log('🔍 AuthenticatedLayout rendering', new Date().toISOString());
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  
  // Initialize the heartbeat hook for the logged-in user
  useHeartbeat();

  useEffect(() => {
    console.log('✅ Component mounted:', 'AuthenticatedLayout');
    setIsMounted(true);
    return () => console.log('❌ Component unmounted:', 'AuthenticatedLayout');
  }, []);

  useEffect(() => {
    // Only run this effect on the client after mount
    if (!isMounted || isUserLoading) return;
    if (!user) {
      router.push('/login');
    }
  }, [user, isUserLoading, isMounted, router]);

  // The server will always render this. The client will also render this on its
  // first pass, preventing a hydration mismatch.
  if (!isMounted || isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // This part is now guaranteed to only run on the client, after hydration.
  return (
    <SidebarProvider>
      <NotificationListener />
      <div className="flex h-full">
          <AppSidebar />
          <main className="flex-1 p-6 overflow-auto">
              {children}
          </main>
      </div>
    </SidebarProvider>
  );
}
