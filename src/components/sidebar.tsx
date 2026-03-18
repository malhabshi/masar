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
  SidebarGroup,
  SidebarGroupLabel,
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
  UserCog,
  RefreshCw,
  Globe,
  UserRoundX,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { where, orderBy, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, Task } from '@/lib/types';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

export function AppSidebar() {
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    const { user, effectiveRole, viewMode, toggleViewMode } = useUser();
    const pathname = usePathname();

    const isManagementRole = user?.role === 'admin' || user?.role === 'department';
    const isEmployeeView = effectiveRole === 'employee';
    
    // 1. Memoize constraints for real-time student monitoring
    const studentQuery = useMemoFirebase(() => {
      if (!user) return null;
      
      // In Employee view, we monitor the assigned portfolio
      if (isEmployeeView && user.civilId) {
          return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
      }
      
      // In Management view, monitor everything for badges
      if (isManagementRole) {
          return query(collection(firestore, 'students'), orderBy('createdAt', 'desc'));
      }
      
      return null;
    }, [user?.civilId, user?.role, effectiveRole, isManagementRole, isEmployeeView]);

    const { data: students } = useCollection<Student>(studentQuery);

    // 2. Listen to tasks targeted at the user or their department
    const taskQuery = useMemoFirebase(() => {
        if (!user) return null;
        
        // Admins see all tasks for global badge
        if (user.role === 'admin' && viewMode === 'management') {
            return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
        }

        // Employee View or Department View: Match targeting logic
        const groups = [user.id, 'all'];
        if (user.department) {
            groups.push(`dept:${user.department}`);
        }

        return query(
            collection(firestore, 'tasks'), 
            where('recipientIds', 'array-contains-any', groups)
        );
    }, [user?.id, user?.role, user?.department, viewMode]);

    const { data: tasks } = useCollection<Task>(taskQuery);

    // 3. Aggregate notification counts based on active view
    const studentNotificationCount = useMemo(() => {
      if (!students || !user) return 0;
      
      return students.reduce((acc, student) => {
        if (!isEmployeeView) {
          return acc + (student.unreadUpdates || 0) + (student.newDocumentsForAdmin || 0);
        } else {
          return acc + (student.employeeUnreadMessages || 0) + (student.newDocumentsForEmployee || 0) + (student.newMissingItemsForEmployee || 0);
        }
      }, 0);
    }, [students, user, isEmployeeView]);

    // 4. Aggregated unread chats for "Chats" link
    const unreadChatCount = useMemo(() => {
      if (!students || !user || !isManagementRole || isEmployeeView) return 0;
      return students.reduce((acc, student) => acc + (student.unreadUpdates || 0), 0);
    }, [students, user, isManagementRole, isEmployeeView]);

    // 5. Tasks notification count
    const unreadTaskCount = useMemo(() => {
        if (!tasks || !user) return 0;
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
    }, [tasks, user]);

    // 6. Change Agent Count for Management (With Precision Regional Routing)
    const changeAgentCount = useMemo(() => {
      if (!students || isEmployeeView) return 0;
      
      let flaggedStudents = students.filter(s => s.changeAgentRequired);
      
      if (effectiveRole === 'department' && user?.department) {
        const dept = user.department;
        flaggedStudents = flaggedStudents.filter(student => {
          // PRECISION: Only count if flagged universities are in this department's region
          const flaggedUnis = student.changeAgentUniversities || [];
          const flaggedCountries = (student.applications || [])
            .filter(app => flaggedUnis.includes(app.university))
            .map(a => a.country);

          return (dept === 'UK' && flaggedCountries.includes('UK')) || 
                 (dept === 'USA' && flaggedCountries.includes('USA')) || 
                 (dept === 'AU/NZ' && (flaggedCountries.includes('Australia') || flaggedCountries.includes('New Zealand')));
        });
      }
      
      return flaggedStudents.length;
    }, [students, isEmployeeView, effectiveRole, user?.department]);

    const userHasRole = (roles: string[]) => roles.includes(effectiveRole);
    
    const mainNav = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'employee', 'department'] },
        { href: '/applicants', label: 'Applicants', icon: Users, roles: ['admin', 'employee', 'department'] },
        { href: '/unassigned-students', label: 'Unassigned', icon: UserPlus, roles: ['admin', 'employee', 'department'] },
        { href: '/approved-universities', label: 'Universities', icon: Library, roles: ['admin', 'employee', 'department'] },
        { href: '/finalized-students', label: 'Finalized', icon: GraduationCap, roles: ['admin', 'employee', 'department'] },
        { href: '/resources', label: 'Resources', icon: Book, roles: ['admin', 'employee', 'department'] },
    ];
    
    const managementNav = [
        { href: '/all-applications', label: 'Applications', icon: Globe, roles: ['admin', 'department'] },
        { href: '/change-agent-dashboard', label: 'Change Agent', icon: UserRoundX, roles: ['admin', 'department'], badge: changeAgentCount },
        { href: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'department'], badge: unreadTaskCount },
        { href: '/invoices', label: 'Invoices', icon: ReceiptText, roles: ['admin'] },
        { href: '/ielts-course-dashboard', label: 'IELTS Courses', icon: BookOpenCheck, roles: ['admin'] },
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

            {!isEmployeeView && isManagementRole && <SidebarSeparator />}
            
            {!isEmployeeView && managementNav.map((item) => ( userHasRole(item.roles) &&
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

            {!isEmployeeView && user?.role === 'admin' && <SidebarSeparator />}
            
            {!isEmployeeView && adminNav.map((item) => ( userHasRole(item.roles) &&
                <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={pathname.startsWith(item.href)}>
                        <Link href={item.href}>
                            <item.icon /> <span>{item.label}</span>
                        </Link>
                    </SidebarMenuButton>
                </SidebarMenuItem>
            ))}
            </SidebarMenu>

            {isManagementRole && (
              <SidebarGroup className="mt-auto">
                <SidebarGroupLabel>Switch View</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      onClick={toggleViewMode}
                      className={cn(
                        "font-bold transition-all",
                        isEmployeeView ? "bg-orange-100 text-orange-700 hover:bg-orange-200" : "bg-primary/10 text-primary hover:bg-primary/20"
                      )}
                    >
                      {isEmployeeView ? <UserCog /> : <RefreshCw />}
                      <span>{isEmployeeView ? "Management View" : "Employee View"}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            )}
        </SidebarContent>
        <SidebarFooter>
            <SidebarSeparator />
            <UserSwitcher />
        </SidebarFooter>
        </Sidebar>
    );
}
