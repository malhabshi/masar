
'use client';

import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from '@/components/ui/sidebar';
import { Logo } from '@/components/logo';
import { UserSwitcher } from '@/components/user-switcher';
import { useUser } from '@/hooks/use-user';
import { useFirebase } from '@/firebase';
import {
  LayoutDashboard,
  Users,
  Settings,
  Bot,
  LifeBuoy,
  MessageSquare,
  Timer,
  ListChecks,
  Link as LinkIcon,
  UserPlus,
  UserCog,
  Loader2,
  School,
  Award,
  BarChart,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations('Sidebar');
  const { user: userProfile, isUserLoading } = useUser();
  const { auth, user: authUser } = useFirebase();
  const router = useRouter();

  useEffect(() => {
    // This effect handles redirection for unauthenticated users.
    if (!isUserLoading && !authUser) {
      router.replace('/login');
    }
  }, [isUserLoading, authUser, router]);

  // Primary loading state: waits for auth and profile to be resolved.
  if (isUserLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // After loading, if there's still no authenticated user, show a loader while useEffect redirects.
  if (!authUser) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If authenticated but the profile is missing, this is a critical error state.
  if (!userProfile) {
    return (
       <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background p-4 text-center">
        <h1 className="text-2xl font-bold text-destructive">User Profile Not Found</h1>
        <p className="max-w-md text-muted-foreground">
          Your account is authenticated, but we could not find your user profile in the database.
          This can happen if there was an issue during account creation.
        </p>
        <Button variant="destructive" onClick={() => signOut(auth)}>
          Log Out and Try Again
        </Button>
      </div>
    );
  }


  // If all checks pass, render the full application layout.
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader>
          <Logo />
        </SidebarHeader>
        <SidebarContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/dashboard">
                  <LayoutDashboard />
                  <span>{t('dashboard')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/applicants">
                  <Users />
                  <span>{t('applicants')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/unassigned-students">
                  <UserPlus />
                  <span>{t('unassignedStudents')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/resources">
                  <LinkIcon />
                  <span>{t('resources')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/approved-universities">
                  <School />
                  <span>{t('approvedUniversities')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/finalized-students">
                  <Award />
                  <span>{t('finalizedStudents')}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {userProfile.role === 'admin' && (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/employee-activity">
                      <Timer />
                      <span>{t('employeeActivity')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/user-management">
                      <UserCog />
                      <span>{t('userManagement')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/reports">
                      <BarChart />
                      <span>{t('reports')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                        <a href="/request-settings">
                        <Settings />
                        <span>{t('requestSettings')}</span>
                        </a>
                    </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            )}

            {(userProfile.role === 'admin' || userProfile.role === 'department') && (
               <>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/internal-chat">
                      <MessageSquare />
                      <span>{t('internalChat')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/tasks">
                      <ListChecks />
                      <span>{t('tasks')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/customize-questions">
                      <Bot />
                      <span>{t('customizeQuestions')}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            )}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
            <SidebarMenu>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                        <a href="/support">
                            <LifeBuoy />
                            <span>{t('support')}</span>
                        </a>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                {userProfile.role === 'admin' && (
                  <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                          <a href="/settings">
                              <Settings />
                              <span>{t('settings')}</span>
                          </a>
                      </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
            </SidebarMenu>
          <div className="flex items-center justify-between p-2">
            <div className="flex-1 min-w-0">
                <UserSwitcher />
            </div>
            
          </div>
        </SidebarFooter>
      </Sidebar>
      <div className="flex-1 flex flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-card px-4 md:px-6 sticky top-0 z-30">
          <SidebarTrigger className="md:hidden" />
          <h1 className="text-lg font-semibold md:text-xl capitalize">
            Dashboard
          </h1>
        </header>
        <main className="flex-1 overflow-y-auto bg-background">
            <div className="p-4 md:p-6 h-[calc(100vh_-_56px)]">
                {children}
            </div>
        </main>
      </div>
    </SidebarProvider>
  );
}
