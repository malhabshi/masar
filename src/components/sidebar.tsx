'use client';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  SidebarSeparator,
} from '@/components/ui/sidebar';
import { Logo } from '@/components/logo';
import { UserSwitcher } from '@/components/user-switcher';
import { useUser } from '@/hooks/use-user';
import {
  LayoutDashboard,
  Users,
  Book,
  UserPlus,
  GraduationCap,
  Library,
  ClipboardList,
  MessageSquare,
  BarChart,
  Users2,
  Settings,
  Wrench,
  Settings2,
  LineChart,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export function AppSidebar() {
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      console.log('✅ Component mounted:', 'AppSidebar');
      setIsClient(true);
      return () => console.log('❌ Component unmounted:', 'AppSidebar');
    }, []);

    const { user } = useUser();
    const pathname = usePathname();

    const userHasRole = (roles: string[]) => user && roles.includes(user.role);
    
    const mainNav = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'employee', 'department'] },
        { href: '/applicants', label: 'Applicants', icon: Users, roles: ['admin', 'employee', 'department'] },
        { href: '/approved-universities', label: 'Universities', icon: Library, roles: ['admin', 'employee', 'department'] },
        { href: '/finalized-students', label: 'Finalized', icon: GraduationCap, roles: ['admin', 'employee', 'department'] },
        { href: '/resources', label: 'Resources', icon: Book, roles: ['admin', 'employee', 'department'] },
    ];
    
    const managementNav = [
        { href: '/unassigned-students', label: 'Unassigned', icon: UserPlus, roles: ['admin', 'department'] },
        { href: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'department'] },
        { href: '/internal-chat', label: 'Chats', icon: MessageSquare, roles: ['admin', 'department'] },
    ];

    const adminNav = [
        { href: '/reports', label: 'Reports', icon: BarChart, roles: ['admin', 'department'] },
        { href: '/employee-students-count', label: 'Employee Stats', icon: BarChart, roles: ['admin', 'department'] },
        { href: '/user-management', label: 'User Management', icon: Users2, roles: ['admin'] },
        { href: '/request-settings', label: 'Request Settings', icon: Settings2, roles: ['admin', 'department'] },
        { href: '/customize-questions', label: 'Questions', icon: Wrench, roles: ['admin'] },
        { href: '/settings', label: 'App Settings', icon: Settings, roles: ['admin'] },
    ];
    
    if (!isClient) {
      return <div className="w-64 bg-sidebar" />; // Empty sidebar placeholder
    }

    return (
        <Sidebar>
        <SidebarHeader>
            <Logo />
        </SidebarHeader>
        <SidebarContent>
            <SidebarMenu>
            {mainNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname.startsWith(item.href)}>
                            <item.icon /> <span>{item.label}</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            ))}

            {(userHasRole(['admin', 'department'])) && <SidebarSeparator />}
            
            {managementNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname.startsWith(item.href)}>
                            <item.icon /> <span>{item.label}</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            ))}

            {userHasRole(['admin', 'department']) && <SidebarSeparator />}
            
            {adminNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname.startsWith(item.href)}>
                            <item.icon /> <span>{item.label}</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            ))}
            </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
            <SidebarSeparator />
            <UserSwitcher />
        </SidebarFooter>
        </Sidebar>
    );
}
