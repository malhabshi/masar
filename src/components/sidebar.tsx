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
  Settings2,
  LineChart,
  BookOpenCheck,
  BellRing,
  ReceiptText,
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
    
    // 1. Memoize constraints for real-time student monitoring
    const studentQuery = useMemoFirebase(() => {
      if (!user) return null;
      const isAdminDeptRole = user.role === 'admin' || user.role === 'department';
      const isEmployeeRole = user.role === 'employee';
      const hasCivilId = !!user.civilId;

      if (isAdminDeptRole) {
          return query(collection(firestore, 'students'), orderBy('createdAt', 'desc'));
      }
      
      if (isEmployeeRole && hasCivilId) {
          return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
      }
      
      return null;
    }, [user?.civilId, user?.role, user?.id]);

    const { data: students } = useCollection<Student>(studentQuery);

    // 2. Listen to tasks targeted at the user or their department
    const taskQuery = useMemoFirebase(() => {
        if (!user || !isAdminDept) return null;
        
        // Admins see all tasks for global badge
        if (user.role === 'admin') {
            return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
        }

        // Department users: Badge logic matches Dashboard logic (ID, dept group, and 'all')
        const groups = [user.id, 'all'];
        if (user.department) {
            groups.push(`dept:${user.department}`);
        }

        return query(
            collection(firestore, 'tasks'), 
            where('recipientIds', 'array-contains-any', groups)
        );
    }, [user?.id, user?.role, user?.department, isAdminDept]);

    const { data: tasks } = useCollection<Task>(taskQuery);

    // 3. Aggregate notification counts based on user role (Student profile updates)
    const studentNotificationCount = useMemo(() => {
      if (!students || !user) return 0;
      
      return students.reduce((acc, student) => {
        if (user.role === 'admin' || user.role === 'department') {
          return acc + (student.unreadUpdates || 0) + (student.newDocumentsForAdmin || 0);
        } else if (user.role === 'employee') {
          return acc + (student.employeeUnreadMessages || 0) + (student.newDocumentsForEmployee || 0) + (student.newMissingItemsForEmployee || 0);
        }
        return acc;
      }, 0);
    }, [students, user]);

    // 4. Aggregated unread chats for "Chats" link
    const unreadChatCount = useMemo(() => {
      if (!students || !user || !['admin', 'department'].includes(user.role)) return 0;
      return students.reduce((acc, student) => acc + (student.unreadUpdates || 0), 0);
    }, [students, user]);

    // 5. Tasks notification count (Real-time tracking of 'new' tasks)
    const unreadTaskCount = useMemo(() => {
        if (!tasks || !isAdminDept || !user) return 0;
        return tasks.filter(t => {
            if (t.status !== 'new' || t.category !== 'request') return false;
            
            const hasSeen = t.viewedBy?.some(v => v.userId === user.id);
            if (hasSeen) return false;

            const isIeltsCourse = 
              t.data?.examType === 'ielts_course' || 
              t.requestTypeId === 'ielts_course' ||
              t.taskType?.toLowerCase() === 'ielts course';

            return !isIeltsCourse;
        }).length;
    }, [tasks, isAdminDept, user]);

    // 6. IELTS Courses notification count
    const unreadIeltsCourseCount = useMemo(() => {
        if (!tasks || !user || user.role !== 'admin') return 0;
        return tasks.filter(t => {
            if (t.status !== 'new' || t.category !== 'request') return false;

            const hasSeen = t.viewedBy?.some(v => v.userId === user.id);
            if (hasSeen) return false;

            const isIeltsCourse = 
              t.data?.examType === 'ielts_course' || 
              t.requestTypeId === 'ielts_course' ||
              t.taskType?.toLowerCase() === 'ielts course';

            return isIeltsCourse;
        }).length;
    }, [tasks, user]);

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
        { href: '/invoices', label: 'Invoices', icon: ReceiptText, roles: ['admin', 'department'] },
        { href: '/ielts-course-dashboard', label: 'IELTS Courses', icon: BookOpenCheck, roles: ['admin'], badge: unreadIeltsCourseCount },
        { href: '/internal-chat', label: 'Chats', icon: MessageSquare, roles: ['admin', 'department'], badge: unreadChatCount },
    ];

    const adminNav = [
        { href: '/reports', label: 'Reports', icon: BarChart, roles: ['admin'] },
        { href: '/employee-activity', label: 'User Activity', icon: LineChart, roles: ['admin'] },
        { href: '/employee-students-count', label: 'Employee Stats', icon: BarChart, roles: ['admin'] },
        { href: '/user-management', label: 'User Management', icon: Users2, roles: ['admin'] },
        { href: '/request-settings', label: 'Request Settings', icon: Settings2, roles: ['admin'] },
        { href: '/settings/notifications', label: 'WA Templates', icon: BellRing, roles: ['admin'] },
        { href: '/settings', label: 'App Settings', icon: Settings, roles: ['admin'] },
    ];
    
    if (!isClient) {
      return <div className="w-64 bg-sidebar" />; 
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
                    {item.label === 'Applicants' && studentNotificationCount > 0 && (
                        <SidebarMenuBadge className="bg-destructive text-destructive-foreground">
                            {studentNotificationCount}
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
