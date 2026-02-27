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
  SidebarMenuBadge,
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
  BookOpenCheck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { where, orderBy, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, Task } from '@/lib/types';

export function AppSidebar() {
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    const { user } = useUser();
    const pathname = usePathname();

    const isAdminDept = user?.role === 'admin' || user?.role === 'department';
    const isEmployee = user?.role === 'employee';

    // 1. Memoize constraints to satisfy security rules and optimize cache reuse
    const studentQuery = useMemoFirebase(() => {
      const isAdminDept = user?.role === 'admin' || user?.role === 'department';
      const isEmployee = user?.role === 'employee';
      const hasCivilId = !!user?.civilId;

      if (isAdminDept) {
          return query(collection(firestore, 'students'), orderBy('createdAt', 'desc'));
      }
      
      if (isEmployee && hasCivilId) {
          return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
      }
      
      return null;
    }, [user?.civilId, user?.role]);

    // 2. Listen to students in real-time
    const { data: students } = useCollection<Student>(studentQuery);

    // 3. Listen to tasks for Task notifications (Admin/Dept)
    const taskGroups = useMemo(() => {
        if (!user) return [];
        const g = [user.id, 'all'];
        if (user.role === 'admin') g.push('admins');
        if (user.role === 'department' && user.department) g.push(`dept:${user.department}`);
        return g;
    }, [user]);

    const taskQuery = useMemoFirebase(() => {
        if (!user || !isAdminDept) return null;
        return query(collection(firestore, 'tasks'), where('recipientIds', 'array-contains-any', taskGroups));
    }, [user, isAdminDept, taskGroups]);

    const { data: tasks } = useCollection<Task>(taskQuery);

    // 4. Aggregate notification counts based on user role
    const totalNotifications = useMemo(() => {
      if (!students || !user) return 0;
      
      return students.reduce((acc, student) => {
        if (user.role === 'admin' || user.role === 'department') {
          // Admin/Dept: Count unread chat updates + new documents from employees
          return acc + (student.unreadUpdates || 0) + (student.newDocumentsForAdmin || 0);
        } else if (user.role === 'employee') {
          // Employee: Count messages from admins + new documents from admins + new missing items
          return acc + (student.employeeUnreadMessages || 0) + (student.newDocumentsForEmployee || 0) + (student.newMissingItemsForEmployee || 0);
        }
        return acc;
      }, 0);
    }, [students, user]);

    // 5. Specifically aggregate unread chats for the "Chats" link (Admin/Dept only)
    const unreadChatCount = useMemo(() => {
      if (!students || !user || !['admin', 'department'].includes(user.role)) return 0;
      return students.reduce((acc, student) => acc + (student.unreadUpdates || 0), 0);
    }, [students, user]);

    // 6. Tasks notification count (Excluding IELTS Courses)
    const unreadTaskCount = useMemo(() => {
        if (!tasks || !isAdminDept) return 0;
        return tasks.filter(t => {
            if (t.status !== 'new') return false;
            if (t.category !== 'request') return false;
            const isIeltsCourse = t.data?.examType === 'ielts_course' || 
                                 t.taskType?.toLowerCase() === 'ielts course';
            return !isIeltsCourse;
        }).length;
    }, [tasks, isAdminDept]);

    // 7. IELTS Courses notification count
    const unreadIeltsCourseCount = useMemo(() => {
        if (!tasks || !isAdminDept) return 0;
        return tasks.filter(t => {
            if (t.status !== 'new') return false;
            if (t.category !== 'request') return false;
            const isIeltsCourse = t.data?.examType === 'ielts_course' || 
                                 t.taskType?.toLowerCase() === 'ielts course';
            return isIeltsCourse;
        }).length;
    }, [tasks, isAdminDept]);

    const userHasRole = (roles: string[]) => user && roles.includes(user.role);
    
    const mainNav = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'employee', 'department'] },
        { href: '/applicants', label: 'Applicants', icon: Users, roles: ['admin', 'employee', 'department'] },
        { href: '/unassigned-students', label: 'Unassigned', icon: UserPlus, roles: ['admin', 'employee', 'department'] },
        { href: '/approved-universities', label: 'Universities', icon: Library, roles: ['admin', 'employee', 'department'] },
        { href: '/finalized-students', label: 'Finalized', icon: GraduationCap, roles: ['admin', 'employee', 'department'] },
        { href: '/resources', label: 'Resources', icon: Book, roles: ['admin', 'employee', 'department'] },
    ];
    
    const managementNav = [
        { href: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'department'], badge: unreadTaskCount },
        { href: '/ielts-course-dashboard', label: 'IELTS Courses', icon: BookOpenCheck, roles: ['admin'], badge: unreadIeltsCourseCount },
        { href: '/internal-chat', label: 'Chats', icon: MessageSquare, roles: ['admin', 'department'], badge: unreadChatCount },
    ];

    const adminNav = [
        { href: '/reports', label: 'Reports', icon: BarChart, roles: ['admin'] },
        { href: '/employee-activity', label: 'User Activity', icon: LineChart, roles: ['admin'] },
        { href: '/employee-students-count', label: 'Employee Stats', icon: BarChart, roles: ['admin'] },
        { href: '/user-management', label: 'User Management', icon: Users2, roles: ['admin'] },
        { href: '/request-settings', label: 'Request Settings', icon: Settings2, roles: ['admin'] },
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
                    <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                        <Link href={item.href}>
                            <item.icon /> <span>{item.label}</span>
                        </Link>
                    </SidebarMenuButton>
                    {item.label === 'Applicants' && totalNotifications > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {totalNotifications}
                        </SidebarMenuBadge>
                    )}
                </SidebarMenuItem>
            ))}

            {(userHasRole(['admin', 'department'])) && <SidebarSeparator />}
            
            {managementNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                        <Link href={item.href}>
                            <item.icon /> <span>{item.label}</span>
                        </Link>
                    </SidebarMenuButton>
                    {item.badge !== undefined && item.badge > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {item.badge}
                        </SidebarMenuBadge>
                    )}
                </SidebarMenuItem>
            ))}

            {userHasRole(['admin']) && <SidebarSeparator />}
            
            {adminNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                        <Link href={item.href}>
                            <item.icon /> <span>{item.label}</span>
                        </Link>
                    </SidebarMenuButton>
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
