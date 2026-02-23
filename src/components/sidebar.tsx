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
  LifeBuoy,
  PlusCircle,
  Wrench,
  Settings2,
  LineChart,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppSidebar() {
    const { user } = useUser();
    const pathname = usePathname();

    const userHasRole = (roles: string[]) => user && roles.includes(user.role);
    
    const mainNav = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'employee', 'department'] },
        { href: '/applicants', label: 'Applicants', icon: Users, roles: ['admin', 'employee', 'department'] },
        { href: '/resources', label: 'Resources', icon: Book, roles: ['admin', 'employee', 'department'] },
        { href: '/new-request', label: 'Add Student', icon: PlusCircle, roles: ['employee'] },
    ];
    
    const managementNav = [
        { href: '/unassigned-students', label: 'Unassigned', icon: UserPlus, roles: ['admin', 'department'] },
        { href: '/finalized-students', label: 'Finalized', icon: GraduationCap, roles: ['admin', 'department'] },
        { href: '/approved-universities', label: 'Universities', icon: Library, roles: ['admin', 'department'] },
        { href: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'department'] },
        { href: '/internal-chat', label: 'Chats', icon: MessageSquare, roles: ['admin', 'department'] },
    ];

    const adminNav = [
        { href: '/employee-activity', label: 'Activity', icon: LineChart, roles: ['admin'] },
        { href: '/reports', label: 'Reports', icon: BarChart, roles: ['admin', 'department'] },
        { href: '/user-management', label: 'User Management', icon: Users2, roles: ['admin'] },
        { href: '/request-settings', label: 'Request Settings', icon: Settings2, roles: ['admin'] },
        { href: '/customize-questions', label: 'Questions', icon: Wrench, roles: ['admin'] },
        { href: '/settings', label: 'App Settings', icon: Settings, roles: ['admin'] },
    ];

    const supportNav = { href: '/support', label: 'Support', icon: LifeBuoy, roles: ['admin', 'employee', 'department'] };

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

            {userHasRole(['admin']) && <SidebarSeparator />}
            
            {adminNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <Link href={item.href}>
                        <SidebarMenuButton isActive={pathname.startsWith(item.href)}>
                            <item.icon /> <span>{item.label}</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            ))}

            <SidebarSeparator />
            
            {userHasRole(supportNav.roles) && 
                <SidebarMenuItem>
                    <Link href={supportNav.href}>
                        <SidebarMenuButton isActive={pathname.startsWith(supportNav.href)}>
                            <supportNav.icon /> <span>{supportNav.label}</span>
                        </SidebarMenuButton>
                    </Link>
                </SidebarMenuItem>
            }
            </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
            <SidebarSeparator />
            <UserSwitcher />
        </SidebarFooter>
        </Sidebar>
    );
}
