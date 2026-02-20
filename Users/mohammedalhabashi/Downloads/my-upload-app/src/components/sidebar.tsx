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
  PlusCircle
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function AppSidebar() {
    const { user } = useUser();
    const pathname = usePathname();

    const navItems = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        { href: '/applicants', label: 'Applicants', icon: Users },
    ];
    
    const employeeNavItems = [
        { href: '/new-request', label: 'Add Student', icon: PlusCircle },
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
                  isActive={pathname === item.href}
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
                    isActive={pathname === item.href}
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
