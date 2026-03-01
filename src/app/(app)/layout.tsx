'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useHeartbeat } from '@/hooks/use-heartbeat';
import { AppSidebar } from '@/components/sidebar';
import { Loader2 } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { NotificationListener } from '@/components/notifications/notification-listener';
import { processInactivityReminders } from '@/lib/actions';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  
  // Initialize the heartbeat hook for the logged-in user
  useHeartbeat();

  useEffect(() => {
    // Moved logging into useEffect to avoid hydration mismatches with new Date()
    console.log('🔍 AuthenticatedLayout mounted at:', new Date().toISOString());
    setIsMounted(true);
    
    // Trigger an initial background check for student inactivity reminders
    if (user && ['admin', 'employee'].includes(user.role)) {
      processInactivityReminders();
    }

    return () => console.log('❌ Component unmounted:', 'AuthenticatedLayout');
  }, [user]);

  useEffect(() => {
    // Only run this effect on the client after mount
    if (!isMounted || isUserLoading) return;
    if (!user) {
      router.push('/login');
    }
  }, [user, isUserLoading, isMounted, router]);

  // Prevent hydration mismatches by returning a generic loading state on the first pass
  if (!isMounted || isUserLoading || !user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

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
