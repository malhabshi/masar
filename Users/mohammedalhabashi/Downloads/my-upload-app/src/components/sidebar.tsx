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
  PlusCircle,
  Users2,
  BarChart,
  Settings,
  Book,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppSidebar() {
    const { user } = useUser();
    const pathname = usePathname();

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/applicants', label: 'Applicants', icon: Users },
        { href: '/resources', label: 'Resources', icon: Book },
    ];
    
    const employeeNavItems = [
        { href: '/new-request', label: 'Add Student', icon: PlusCircle },
    ];

    const adminNavItems = [
        { href: '/user-management', label: 'User Management', icon: Users2 },
        { href: '/reports', label: 'Reports', icon: BarChart },
        { href: '/settings', label: 'Settings', icon: Settings },
    ];
    
    const departmentNavItems = [
         { href: '/reports', label: 'Reports', icon: BarChart },
    ];


  return (
    <Sidebar>
      <SidebarHeader>
        <Logo />
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {navItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <Link href={item.href} passHref legacyBehavior>
                <SidebarMenuButton
                  isActive={pathname.startsWith(item.href)}
                  asChild
                >
                  <item.icon />
                  {item.label}
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
          {user?.role === 'employee' && employeeNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
                <Link href={item.href} passHref legacyBehavior>
                    <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    asChild
                    >
                    <item.icon />
                    {item.label}
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
          ))}
          {(user?.role === 'admin') && <SidebarSeparator />}
          {user?.role === 'admin' && adminNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
                <Link href={item.href} passHref legacyBehavior>
                    <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    asChild
                    >
                    <item.icon />
                    {item.label}
                    </SidebarMenuButton>
                </Link>
            </SidebarMenuItem>
          ))}
           {(user?.role === 'department') && <SidebarSeparator />}
           {user?.role === 'department' && departmentNavItems.map((item) => (
            <SidebarMenuItem key={item.href}>
                <Link href={item.href} passHref legacyBehavior>
                    <SidebarMenuButton
                    isActive={pathname.startsWith(item.href)}
                    asChild
                    >
                    <item.icon />
                    {item.label}
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
