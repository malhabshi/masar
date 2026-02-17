
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
import { useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { Button } from '@/components/ui/button';
import { useEffect } from 'react';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user: userProfile, isUserLoading } = useUser();
  const { auth, user: authUser } = useFirebase();
  const router = useRouter();

  useEffect(() => {
    // This effect handles redirection for unauthenticated users.
    if (!isUserLoading && !authUser) {
      router.replace('/en/login');
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
                <a href="/en/dashboard">
                  <LayoutDashboard />
                  <span>Dashboard</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/en/applicants">
                  <Users />
                  <span>Applicants</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/en/unassigned-students">
                  <UserPlus />
                  <span>Unassigned Students</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/en/resources">
                  <LinkIcon />
                  <span>Resources</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/en/approved-universities">
                  <School />
                  <span>Approved Universities</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a href="/en/finalized-students">
                  <Award />
                  <span>Finalized Students</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>

            {userProfile.role === 'admin' && (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/employee-activity">
                      <Timer />
                      <span>Employee Activity</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/user-management">
                      <UserCog />
                      <span>User Management</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/reports">
                      <BarChart />
                      <span>Reports</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                    <SidebarMenuButton asChild>
                        <a href="/en/request-settings">
                        <Settings />
                        <span>Request Settings</span>
                        </a>
                    </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            )}

            {(userProfile.role === 'admin' || userProfile.role === 'department') && (
               <>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/internal-chat">
                      <MessageSquare />
                      <span>Internal Chat</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/tasks">
                      <ListChecks />
                      <span>Tasks</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild>
                    <a href="/en/customize-questions">
                      <Bot />
                      <span>Customize Questions</span>
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
                        <a href="/en/support">
                            <LifeBuoy />
                            <span>Support</span>
                        </a>
                    </SidebarMenuButton>
                </SidebarMenuItem>
                {userProfile.role === 'admin' && (
                  <SidebarMenuItem>
                      <SidebarMenuButton asChild>
                          <a href="/en/settings">
                              <Settings />
                              <span>Settings</span>
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
