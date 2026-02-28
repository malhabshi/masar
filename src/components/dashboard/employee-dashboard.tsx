
'use client';

import { useMemo } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Student, Task } from '@/lib/types';
import { Users, FileText, AlertCircle, ArrowRight } from 'lucide-react';
import { sortByDate } from '@/lib/timestamp-utils';
import type { AppUser } from '@/hooks/use-user';
import Link from 'next/link';

// Components
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { TaskList } from '@/components/dashboard/task-list';
import { PersonalTodoList } from '@/components/dashboard/personal-todo-list';
import { UpcomingEventsCard } from '@/components/dashboard/upcoming-events-card';
import { Badge } from '@/components/ui/badge';

export default function EmployeeDashboard({ currentUser }: { currentUser: AppUser }) {
    const myStudentsConstraints = useMemoFirebase(() => {
        return currentUser.civilId ? [where('employeeId', '==', currentUser.civilId)] : [];
    }, [currentUser.civilId]);

    const { data: myStudentsData, isLoading: studentsLoading } = useCollection<Student>(
        currentUser.civilId ? 'students' : '', 
        ...myStudentsConstraints
    );
    const myStudents = useMemo(() => myStudentsData || [], [myStudentsData]);

    const changeAgentRequiredStudents = useMemo(() => {
        return myStudents.filter(s => s.changeAgentRequired);
    }, [myStudents]);

    const relevantTasksConstraints = useMemoFirebase(() => {
        if (!currentUser) return [];
        // Query tasks directed to this user specifically, their department, or everyone
        const groups = [currentUser.id, 'all'];
        if (currentUser.role === 'admin') groups.push('admins');
        if (currentUser.department) groups.push(`dept:${currentUser.department}`);
        
        return [where('recipientIds', 'array-contains-any', groups)];
    }, [currentUser]);

    const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(
        currentUser ? 'tasks' : '', 
        ...relevantTasksConstraints
    );

    const isLoading = studentsLoading || tasksLoading;

    const relevantTasks = useMemo(() => {
        return (tasksData || []).sort((a, b) => sortByDate(a, b));
    }, [tasksData]);

    const stats = useMemo(() => {
        const myTotalStudents = myStudents.length;
        const myPendingApplications = myStudents.reduce((acc, s) => {
            return acc + (s.applications?.filter(a => a.status === 'Pending').length || 0);
        }, 0);
        return { myTotalStudents, myPendingApplications };
    }, [myStudents]);


    return (
        <div className="space-y-6">
            {changeAgentRequiredStudents.length > 0 && (
              <Card className="border-red-500 bg-red-50">
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2 text-red-600">
                    <AlertCircle className="h-6 w-6 animate-bounce" />
                    <CardTitle className="text-xl font-black">🚨 URGENT: Change Agent Required</CardTitle>
                  </div>
                  <CardDescription className="text-red-700 font-medium">Management has flagged these students for immediate action.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {changeAgentRequiredStudents.map(student => (
                      <Link key={student.id} href={`/student/${student.id}`}>
                        <div className="bg-black p-4 rounded-lg flex items-center justify-between border-2 border-red-500 transition-transform hover:scale-[1.02]">
                          <span className="text-red-500 font-bold truncate">{student.name}</span>
                          <ArrowRight className="h-4 w-4 text-red-500" />
                        </div>
                      </Link>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 md:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">My Assigned Students</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.myTotalStudents}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">My Pending Applications</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{isLoading ? '...' : stats.myPendingApplications}</div>
                    </CardContent>
                </Card>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <TaskList tasks={relevantTasks} currentUser={currentUser} isLoading={isLoading} />
                <UpcomingEventsCard />
            </div>
            <PersonalTodoList />
        </div>
    );
}
