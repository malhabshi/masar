'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useHeartbeat } from '@/hooks/use-heartbeat';
import { AppSidebar } from '@/components/sidebar';
import { Loader2 } from 'lucide-react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { NotificationListener } from '@/components/notifications/notification-listener';
import { processInactivityReminders, processStudentReminders } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';

export default function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isUserLoading } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const [isMounted, setIsMounted] = useState(false);

  useHeartbeat();

  useEffect(() => {
    console.log('🔍 AuthenticatedLayout mounted at:', new Date().toISOString());
    setIsMounted(true);

    if (user && ['admin', 'employee'].includes(user.role)) {
      processInactivityReminders();
    }

    return () => console.log('❌ Component unmounted:', 'AuthenticatedLayout');
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const cooldownKey = `reminder_check_${user.id}`;
    const last = localStorage.getItem(cooldownKey);
    if (last && Date.now() - Number(last) < 10 * 60 * 1000) return;
    localStorage.setItem(cooldownKey, String(Date.now()));
    processStudentReminders({
      userId: user.id,
      userRole: user.role,
      userDepartment: user.department,
      userCivilId: user.civilId,
    }).then(({ triggered }) => {
      triggered.forEach(r => {
        toast({
          title: `Reminder: ${r.title}`,
          description: r.description || `Student: ${r.studentName}`,
          duration: 10000,
          action: (
            <ToastAction altText="View student" onClick={() => router.push(`/student/${r.studentId}`)}>
              View
            </ToastAction>
          ),
        });
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!isMounted || isUserLoading) return;
    if (!user) {
      router.push('/login');
    }
  }, [user, isUserLoading, isMounted, router]);

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
