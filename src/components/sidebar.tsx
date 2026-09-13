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
  ScrollText,
  ReceiptText,
  UserCog,
  RefreshCw,
  Globe,
  UserRoundX,
  Link2,
  Calculator,
  Send,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase';
import { where, collection, query } from 'firebase/firestore';
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

    const isManagementRole = user?.role === 'admin' || user?.role === 'adminplus' || user?.role === 'department';
    const isEmployeeView = effectiveRole === 'employee';
    
    // Every badge below used to work by downloading the ENTIRE students/tasks collection
    // and counting in JavaScript. Verified against real production data (see conversation)
    // that switching to targeted, field-specific queries — asking the database directly
    // "which students have unread chat for ME" instead of "give me everyone, I'll check
    // myself" — produces IDENTICAL numbers while fetching a tiny fraction of the documents.
    // Employee-view portfolio query — already narrow, unchanged.
    const employeeStudentQuery = useMemoFirebase(() => {
      if (!user || !isEmployeeView || !user.civilId) return null;
      return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }, [user?.civilId, isEmployeeView]);
    const { data: employeeStudents } = useCollection<Student>(employeeStudentQuery);

    // Management-view badges: one small targeted query per notification TYPE, instead of
    // one giant query for every student.
    const chatUnreadQuery = useMemoFirebase(() => {
      if (!user || isEmployeeView || !isManagementRole) return null;
      return query(collection(firestore, 'students'), where(`chatUnreadCountByUser.${user.id}`, '>', 0));
    }, [user?.id, isEmployeeView, isManagementRole]);
    const { data: chatUnreadStudents } = useCollection<Student>(chatUnreadQuery);

    const newDocsQuery = useMemoFirebase(() => {
      if (!user || isEmployeeView || !isManagementRole) return null;
      return query(collection(firestore, 'students'), where('newDocumentsForAdmin', '>', 0));
    }, [user?.id, isEmployeeView, isManagementRole]);
    const { data: newDocsStudents } = useCollection<Student>(newDocsQuery);

    const newUploadsQuery = useMemoFirebase(() => {
      if (!user || isEmployeeView || !isManagementRole) return null;
      return query(collection(firestore, 'students'), where('newPublicUploadsForAdmin', '>', 0));
    }, [user?.id, isEmployeeView, isManagementRole]);
    const { data: newUploadsStudents } = useCollection<Student>(newUploadsQuery);

    // Dedicated, cheap query for the Change Agent badge — filters server-side instead of
    // downloading every student, and stays exact regardless of how old the flag is.
    const changeAgentQuery = useMemoFirebase(() => {
      if (!user || isEmployeeView) return null;
      return query(collection(firestore, 'students'), where('changeAgentRequired', '==', true));
    }, [user?.id, isEmployeeView]);
    const { data: changeAgentStudents } = useCollection<Student>(changeAgentQuery);

    // Dedicated, cheap query for the Finalized badge.
    const finalizedQuery = useMemoFirebase(() => {
      if (!user || !isManagementRole || isEmployeeView) return null;
      return query(collection(firestore, 'students'), where('finalChoiceUniversity', '>', ''));
    }, [user?.id, isManagementRole, isEmployeeView]);
    const { data: finalizedStudents } = useCollection<Student>(finalizedQuery);

    // Admin/department's OWN portfolio (for the "Switch View" pill), same narrow shape as
    // the employee-view query above.
    const myPortfolioQuery = useMemoFirebase(() => {
      if (!user || isEmployeeView || !user.civilId) return null;
      return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }, [user?.civilId, isEmployeeView]);
    const { data: myPortfolioStudents } = useCollection<Student>(myPortfolioQuery);

    // Tasks targeted at the user or their department — already narrow (was previously
    // widened to "every task in the system" for admins, even though the badge only ever
    // counted tasks addressed to that one user).
    const taskQuery = useMemoFirebase(() => {
        if (!user) return null;

        const groups = [user.id, 'all'];
        if (user.department) {
            groups.push(`dept:${user.department}`);
        }

        return query(
            collection(firestore, 'tasks'),
            where('recipientIds', 'array-contains-any', groups)
        );
    }, [user?.id, user?.department]);

    const { data: tasks } = useCollection<Task>(taskQuery);

    // 3. Aggregate notification counts based on active view
    const studentNotificationCount = useMemo(() => {
      if (!user) return 0;

      if (isEmployeeView) {
        if (!employeeStudents) return 0;
        return employeeStudents.reduce((acc, student) => {
          const um = (student.employeeUnreadMessages || 0) > 0 && (!student.updatesViewedBy || !student.updatesViewedBy.includes(user.id)) ? student.employeeUnreadMessages || 0 : 0;
          const ed = (student.newDocumentsForEmployee || 0) > 0 && (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(user.id)) ? student.newDocumentsForEmployee || 0 : 0;
          const mi = (student.newMissingItemsForEmployee || 0) > 0 && (!student.missingItemsViewedBy || !student.missingItemsViewedBy.includes(user.id)) ? student.newMissingItemsForEmployee || 0 : 0;
          const pu = (student.newPublicUploadsForEmployee || 0) > 0 && (!student.publicUploadsViewedBy || !student.publicUploadsViewedBy.includes(user.id)) ? student.newPublicUploadsForEmployee || 0 : 0;
          return acc + um + ed + mi + pu;
        }, 0);
      }

      let sum = 0;
      for (const student of chatUnreadStudents || []) sum += student.chatUnreadCountByUser?.[user.id] || 0;
      for (const student of newDocsStudents || []) {
        if (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(user.id)) sum += student.newDocumentsForAdmin || 0;
      }
      for (const student of newUploadsStudents || []) {
        if (!student.publicUploadsViewedBy || !student.publicUploadsViewedBy.includes(user.id)) sum += student.newPublicUploadsForAdmin || 0;
      }
      return sum;
    }, [user, isEmployeeView, employeeStudents, chatUnreadStudents, newDocsStudents, newUploadsStudents]);

    // 4. Aggregated unread chats for "Chats" link
    const unreadChatCount = useMemo(() => {
      if (!user || !isManagementRole || isEmployeeView) return 0;
      return (chatUnreadStudents || []).reduce((acc, student) => acc + (student.chatUnreadCountByUser?.[user.id] || 0), 0);
    }, [chatUnreadStudents, user, isManagementRole, isEmployeeView]);

    // 5. Tasks notification count — active personal tasks (new or in-progress), matching "My Tasks" tab logic
    const unreadTaskCount = useMemo(() => {
        if (!tasks || !user) return 0;
        return tasks.filter(t => {
            if (t.category !== 'request') return false;
            const isIeltsCourse = t.data?.examType === 'ielts_course' ||
                                  t.requestTypeId === 'ielts_course' ||
                                  t.taskType?.toLowerCase() === 'ielts course';
            if (isIeltsCourse) return false;
            const isUnifiedExam = t.data?.examType === 'unified_exam' ||
                                  t.taskType?.toLowerCase() === 'unified exam';
            if (isUnifiedExam) return false;
            const isTransferOrDeletion = t.taskType === 'Transfer Request' ||
                                         t.taskType === 'Deletion Request' ||
                                         t.content?.toLowerCase().includes('transfer request') ||
                                         t.content?.toLowerCase().includes('deletion request');
            if (isTransferOrDeletion) return false;
            const targets = t.recipientIds || (t.recipientId ? [t.recipientId] : []);
            if (!targets.includes(user.id)) return false;
            return t.status === 'new' || t.status === 'in-progress';
        }).length;
    }, [tasks, user]);

    // 6. Change Agent Count for Management (With Precision Regional Routing)
    const changeAgentCount = useMemo(() => {
      if (!changeAgentStudents || isEmployeeView) return 0;

      let flaggedStudents = changeAgentStudents;

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
    }, [changeAgentStudents, isEmployeeView, effectiveRole, user?.department]);

    // 7. Unread Finalized Students for Admin/Department
    const unreadFinalizedCount = useMemo(() => {
        if (!finalizedStudents || !user || !isManagementRole) return 0;

        return finalizedStudents.filter(s =>
            (!s.finalizedViewedBy || !s.finalizedViewedBy.includes(user.id))
        ).length;
    }, [finalizedStudents, user, isManagementRole]);

    const userHasRole = (roles: string[]) => roles.includes(effectiveRole);

    // 7. Track background updates for Employee View when staying on Management View
    const employeeUnreadCount = useMemo(() => {
      if (!myPortfolioStudents || !user || !user.civilId || isEmployeeView) return 0;
      return myPortfolioStudents.reduce((acc, student) => {
          return acc + (student.employeeUnreadMessages || 0) + (student.newDocumentsForEmployee || 0) + (student.newMissingItemsForEmployee || 0) + (student.isNewForEmployee ? 1 : 0);
      }, 0);
    }, [myPortfolioStudents, user, isEmployeeView]);
    
    const mainNav = [
        { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/applicants', label: 'Applicants', icon: Users, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/unassigned-students', label: 'Unassigned', icon: UserPlus, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/approved-universities', label: 'Universities', icon: Library, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/finalized-students', label: 'Finalized', icon: GraduationCap, roles: ['admin', 'adminplus', 'employee', 'department'], badge: unreadFinalizedCount },
        { href: '/resources', label: 'Resources', icon: Book, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/gpa', label: 'GPA Calculator', icon: Calculator, roles: ['admin', 'adminplus', 'employee', 'department'] },
        { href: '/jotform', label: 'Jotform', icon: Send, roles: ['admin', 'adminplus', 'employee', 'department'] },
    ];

    const managementNav = [
        { href: '/all-applications', label: 'Applications', icon: Globe, roles: ['admin', 'adminplus', 'department'] },
        { href: '/change-agent-dashboard', label: 'Change Agent', icon: UserRoundX, roles: ['admin', 'adminplus', 'department'], badge: changeAgentCount },
        { href: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['admin', 'department'], badge: unreadTaskCount },
        { href: '/invoices', label: 'Invoices', icon: ReceiptText, roles: ['admin'] },
        { href: '/ielts-course-dashboard', label: 'IELTS Courses', icon: BookOpenCheck, roles: ['admin'] },
        { href: '/unified-exam', label: 'Unified Exam', icon: ScrollText, roles: ['admin', 'adminplus'] },
        { href: '/internal-chat', label: 'Chats', icon: MessageSquare, roles: ['admin', 'department'], badge: unreadChatCount },
    ];

    const adminNav = [
        { href: '/reports', label: 'Reports', icon: BarChart, roles: ['admin'] },
        { href: '/employee-activity', label: 'User Activity', icon: LineChart, roles: ['admin'] },
        { href: '/employee-students-count', label: 'Employee Stats', icon: BarChart, roles: ['admin'] },
        { href: '/user-management', label: 'User Management', icon: Users2, roles: ['admin'] },
        { href: '/request-settings', label: 'Request Settings', icon: Settings2, roles: ['admin'] },
        { href: '/unified-exam-settings', label: 'Unified Exam Dates', icon: ScrollText, roles: ['admin'] },
        { href: '/gpa-settings', label: 'GPA Settings', icon: Calculator, roles: ['admin'] },
        { href: '/upload-links', label: 'Upload Links', icon: Link2, roles: ['admin'] },
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
                    {item.label === 'Finalized' && item.badge !== undefined && item.badge > 0 && (
                        <SidebarMenuBadge className="bg-yellow-500 text-white animate-pulse">
                            New
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

            {isManagementRole && user?.role !== 'adminplus' && (
              <SidebarGroup className="mt-auto">
                <SidebarGroupLabel>Switch View</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton 
                      onClick={toggleViewMode}
                      className={cn(
                        "font-bold transition-all relative",
                        isEmployeeView ? "bg-orange-100 text-orange-700 hover:bg-orange-200" : "bg-primary/10 text-primary hover:bg-primary/20",
                        !isEmployeeView && employeeUnreadCount > 0 && "ring-1 ring-yellow-400/50"
                      )}
                    >
                      {isEmployeeView ? <UserCog /> : <RefreshCw className={cn(!isEmployeeView && employeeUnreadCount > 0 && "text-yellow-600")} />}
                      <span className="flex-1 text-left">{isEmployeeView ? "Management View" : "Employee View"}</span>
                      
                      {!isEmployeeView && employeeUnreadCount > 0 && (
                        <span className="flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-yellow-500 text-[10px] font-black text-white shadow-[0_0_10px_rgba(234,179,8,0.5)] animate-pulse">
                          {employeeUnreadCount}
                        </span>
                      )}
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
