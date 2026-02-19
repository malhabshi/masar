
'use client';

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { User, Student, Task, Note } from '@/lib/types';
import { format, formatDistanceStrict } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Clock, MessageSquare, Send, Loader2 } from 'lucide-react';
import { useFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';

function formatDuration(ms: number): string {
    if (ms <= 0) return '0m';
    
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    let result = '';
    if (hours > 0) result += `${hours}h `;
    if (minutes > 0) result += `${minutes}m`;

    return result.trim() || '0m';
}


// --- Daily Report Logic ---
function getDailyReport(date: Date, students: Student[], tasks: Task[], employees: User[]) {
    const reportDateStr = format(date, 'yyyy-MM-dd');
    
    const allNotes: (Note & { studentId: string })[] = students.flatMap(student => 
        student.notes.map(note => ({ ...note, studentId: student.id }))
    );
    
    return employees.map(employee => {
        const tasksSent = tasks.filter(task => 
            task.authorId === employee.id && format(new Date(task.createdAt), 'yyyy-MM-dd') === reportDateStr
        ).length;
        
        const profilesVisited = new Set<string>();
        allNotes.forEach(note => {
            if (note.authorId === employee.id && format(new Date(note.createdAt), 'yyyy-MM-dd') === reportDateStr) {
                profilesVisited.add(note.studentId);
            }
        });

        return {
            employee,
            tasksSent,
            messagesSent: 0, // Temporarily disabled
            profilesVisited: profilesVisited.size,
        };
    });
}


// --- Monthly Report Logic ---
function getMonthlyReport(date: Date, students: Student[], tasks: Task[], employees: User[]) {
    const year = date.getFullYear();
    const month = date.getMonth();
    
    const allNotes: (Note & { studentId: string })[] = students.flatMap(student => 
        student.notes.map(note => ({ ...note, studentId: student.id }))
    );

    return employees.map(employee => {
        const tasksSent = tasks.filter(task => {
            const taskDate = new Date(task.createdAt);
            return task.authorId === employee.id && taskDate.getFullYear() === year && taskDate.getMonth() === month;
        }).length;

        const newStudentsAdded = students.filter(student => {
            if (!student.createdBy) return false;
            const studentDate = new Date(student.createdAt);
            return student.createdBy === employee.id && studentDate.getFullYear() === year && studentDate.getMonth() === month;
        }).length;
        
        const profilesVisited = new Set<string>();
        allNotes.forEach(note => {
            const noteDate = new Date(note.createdAt);
            if (note.authorId === employee.id && noteDate.getFullYear() === year && noteDate.getMonth() === month) {
                profilesVisited.add(note.studentId);
            }
        });

        const totalAssignedStudents = students.filter(s => s.employeeId === employee.id).length;

        return {
            employee,
            tasksSent,
            messagesSent: 0, // Temporarily disabled
            newStudentsAdded,
            profilesVisited: profilesVisited.size,
            totalAssignedStudents,
        };
    });
}

// --- Department Stats ---
function getDepartmentStats(tasks: Task[]) {
    const repliedTasks = tasks.filter(task => task.replies && task.replies.length > 0);
    if(repliedTasks.length === 0) {
        return { avgTaskResponseTime: 'N/A' };
    }

    const totalResponseTime = repliedTasks.reduce((acc, task) => {
        if (!task.replies) return acc;
        const firstReply = [...task.replies].sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0];
        const taskCreationTime = new Date(task.createdAt).getTime();
        const firstReplyTime = new Date(firstReply.createdAt).getTime();
        return acc + (firstReplyTime - taskCreationTime);
    }, 0);

    const avgMs = totalResponseTime / repliedTasks.length;
    
    return {
        avgTaskResponseTime: formatDuration(avgMs)
    };
}


function ReportTable({ data, headers, renderRow }: { data: any[], headers: string[], renderRow: (item: any) => React.ReactNode }) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map(header => <TableHead key={header}>{header}</TableHead>)}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.length > 0 ? data.map(renderRow) : (
            <TableRow>
              <TableCell colSpan={headers.length} className="h-24 text-center">
                No data for this period.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}

export default function ActivityReports() {
    const { user, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();
    const { firestore } = useFirebase();

    const [today, setToday] = useState<Date | null>(null);

    useEffect(() => {
        setToday(new Date());
    }, []);

    const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

    const studentsCollection = useMemo(() => !firestore || !user ? null : collection(firestore, 'students'), [firestore, user]);
    const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsCollection);
    const students = useMemo(() => studentsData || [], [studentsData]);

    const tasksCollection = useMemo(() => !firestore || !user ? null : collection(firestore, 'tasks'), [firestore, user]);
    const { data: tasksData, isLoading: tasksLoading } = useCollection<Task>(tasksCollection);
    const tasks = useMemo(() => tasksData || [], [tasksData]);
    
    const dailyReportData = useMemo(() => {
        if (!today || tasksLoading || studentsLoading) return [];
        return getDailyReport(today, students, tasks, employees)
    }, [today, students, tasks, employees, tasksLoading, studentsLoading]);
    
    const monthlyReportData = useMemo(() => {
        if (!today || tasksLoading || studentsLoading) return [];
        return getMonthlyReport(today, students, tasks, employees)
    }, [today, students, tasks, employees, tasksLoading, studentsLoading]);

    const departmentStats = useMemo(() => getDepartmentStats(tasks), [tasks]);

    if (isUserLoading || usersLoading || !today || tasksLoading || studentsLoading) {
      return (
        <div className="flex h-full w-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      );
    }
    
    if (!user || user.role !== 'admin') {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-muted-foreground">You do not have permission to view this page.</p>
            </div>
        );
    }
    
    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Department Performance</CardTitle>
                    <CardDescription>
                        Overall response time metrics for the entire department.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                        <div className="p-4 bg-muted rounded-lg flex flex-col items-center justify-center">
                            <Clock className="h-6 w-6 text-muted-foreground mb-2" />
                            <h4 className="text-sm font-medium text-muted-foreground">Avg. Task Response Time</h4>
                            <p className="text-2xl font-bold">{departmentStats.avgTaskResponseTime}</p>
                        </div>
                        <div className="p-4 bg-muted rounded-lg flex flex-col items-center justify-center">
                            <MessageSquare className="h-6 w-6 text-muted-foreground mb-2" />
                            <h4 className="text-sm font-medium text-muted-foreground">Avg. Message Response Time</h4>
                            <p className="text-2xl font-bold text-muted-foreground/50">N/A</p>
                            <p className="text-xs text-muted-foreground">Message linking not available</p>
                        </div>
                         <div className="p-4 bg-muted rounded-lg flex flex-col items-center justify-center">
                            <Send className="h-6 w-6 text-muted-foreground mb-2" />
                            <h4 className="text-sm font-medium text-muted-foreground">Avg. Request Response Time</h4>
                            <p className="text-2xl font-bold">{departmentStats.avgTaskResponseTime}</p>
                             <p className="text-xs text-muted-foreground">(Requests are treated as tasks)</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Employee Activity</CardTitle>
                    <CardDescription>
                        Daily and monthly reports of employee activities. Time tracking is not currently implemented.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Tabs defaultValue="daily">
                        <TabsList>
                            <TabsTrigger value="daily">Daily Report ({format(today, 'PPP')})</TabsTrigger>
                            <TabsTrigger value="monthly">Monthly Report ({format(today, 'MMMM yyyy')})</TabsTrigger>
                        </TabsList>
                        <TabsContent value="daily" className="mt-4">
                            <ReportTable
                                headers={['Employee', 'Tasks Sent', 'Interactions']}
                                data={dailyReportData}
                                renderRow={(item: any) => (
                                    <TableRow key={item.employee.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar>
                                                    <AvatarImage src={item.employee.avatarUrl} alt={item.employee.name} />
                                                    <AvatarFallback>{item.employee.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="font-medium">{item.employee.name}</div>
                                                    <div className="text-sm text-muted-foreground">{item.employee.email}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">{item.tasksSent}</TableCell>
                                        <TableCell className="text-center">{item.profilesVisited}</TableCell>
                                    </TableRow>
                                )}
                            />
                        </TabsContent>
                        <TabsContent value="monthly" className="mt-4">
                            <ReportTable
                                headers={['Employee', 'Tasks Sent', 'New Students', 'Interactions', 'Assigned']}
                                data={monthlyReportData}
                                renderRow={(item: any) => (
                                    <TableRow key={item.employee.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <Avatar>
                                                    <AvatarImage src={item.employee.avatarUrl} alt={item.employee.name} />
                                                    <AvatarFallback>{item.employee.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                                <div>
                                                    <div className="font-medium">{item.employee.name}</div>
                                                    <div className="text-sm text-muted-foreground">{item.employee.email}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-center">{item.tasksSent}</TableCell>
                                        <TableCell className="text-center">{item.newStudentsAdded}</TableCell>
                                        <TableCell className="text-center">{item.profilesVisited}</TableCell>
                                        <TableCell className="text-center">{item.totalAssignedStudents}</TableCell>
                                    </TableRow>
                                )}
                            />
                        </TabsContent>
                    </Tabs>
                </CardContent>
            </Card>
        </div>
    );
}
