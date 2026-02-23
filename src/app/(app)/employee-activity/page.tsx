
'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import type { TimeLog } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { DateRange } from 'react-day-picker';
import { addDays, format } from 'date-fns';

// UI Components
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, Calendar as CalendarIcon, BarChart } from 'lucide-react';
import { EmployeeActivityTable } from '@/components/dashboard/employee-activity-table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { toDate } from '@/lib/timestamp-utils';
import { useCollection as useUsersCollection } from '@/firebase/client';
import type { User } from '@/lib/types';

export default function EmployeeActivityPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { data: users, isLoading: usersLoading } = useUsersCollection<User>('users');
    
    // State for filters
    const [selectedEmployeeId, setSelectedEmployeeId] = useState('all');
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: addDays(new Date(), -30),
        to: new Date(),
    });
    
    // Determine the query based on user role
    const timeLogsQuery = useMemoFirebase(() => {
        if (!currentUser) return [];
        if (currentUser.role === 'employee' && currentUser.id) {
            return [where('employeeId', '==', currentUser.id)];
        }
        // Admins and departments can see all logs
        return [];
    }, [currentUser?.role, currentUser?.id]);

    const { data: allTimeLogs, isLoading: timeLogsLoading } = useCollection<TimeLog>(
        currentUser ? 'time_logs' : '', 
        ...timeLogsQuery
    );

    const isLoading = isUserLoading || usersLoading || timeLogsLoading;
    
    // Memoize filtered logs
    const filteredLogs = useMemo(() => {
        if (!allTimeLogs) return [];
        
        return allTimeLogs.filter(log => {
            if (!log.clockOut) return false; // Only show completed logs

            const logDate = toDate(log.date);
            if (!logDate) return false;

            const fromDate = dateRange?.from ? new Date(dateRange.from.setHours(0,0,0,0)) : null;
            const toDateRange = dateRange?.to ? new Date(dateRange.to.setHours(23,59,59,999)) : null;
            
            const isAfterStart = !fromDate || logDate >= fromDate;
            const isBeforeEnd = !toDateRange || logDate <= toDateRange;
            
            const matchesDate = isAfterStart && isBeforeEnd;

            // Employee filter is only for admin/dept
            const matchesEmployee = (currentUser?.role !== 'employee' && (selectedEmployeeId === 'all' || log.employeeId === selectedEmployeeId));

            if (currentUser?.role === 'employee') return matchesDate;
            
            return matchesDate && matchesEmployee;
        });
    }, [allTimeLogs, dateRange, selectedEmployeeId, currentUser?.role]);
    
    // Memoize summary stats
    const summaryStats = useMemo(() => {
        const totalMinutes = filteredLogs.reduce((acc, log) => {
            const start = toDate(log.clockIn);
            const end = toDate(log.clockOut);
            if (start && end) {
                return acc + (end.getTime() - start.getTime()) / (1000 * 60);
            }
            return acc;
        }, 0);
        
        const totalHours = totalMinutes / 60;
        
        const employeeHours: Record<string, number> = {};
        filteredLogs.forEach(log => {
            const start = toDate(log.clockIn);
            const end = toDate(log.clockOut);
            if(start && end) {
                const minutes = (end.getTime() - start.getTime()) / (1000 * 60);
                employeeHours[log.employeeId] = (employeeHours[log.employeeId] || 0) + minutes;
            }
        });

        const uniqueEmployeesCount = Object.keys(employeeHours).length;
        const averageHours = uniqueEmployeesCount > 0 ? (totalMinutes / uniqueEmployeesCount) / 60 : 0;
        
        return {
            totalHours: totalHours.toFixed(1),
            averageHours: averageHours.toFixed(1),
            totalLogs: filteredLogs.length,
        };
    }, [filteredLogs]);

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    if (!currentUser) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permissions to view this page.</CardDescription>
                </CardHeader>
            </Card>
        );
    }
    
    const canFilterEmployees = currentUser.role === 'admin' || currentUser.role === 'department';

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Employee Activity</CardTitle>
                    <CardDescription>
                        Track employee clock-in and clock-out times.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Hours Logged</CardTitle>
                                 <BarChart className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{summaryStats.totalHours}</div>
                            </CardContent>
                        </Card>
                         <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Total Logs</CardTitle>
                                <BarChart className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{summaryStats.totalLogs}</div>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Average Hours per Employee</CardTitle>
                                <BarChart className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{summaryStats.averageHours}</div>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 items-center">
                         <Popover>
                            <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                "w-full md:w-[300px] justify-start text-left font-normal",
                                !dateRange && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateRange?.from ? (
                                dateRange.to ? (
                                    <>
                                    {format(dateRange.from, "LLL dd, y")} -{" "}
                                    {format(dateRange.to, "LLL dd, y")}
                                    </>
                                ) : (
                                    format(dateRange.from, "LLL dd, y")
                                )
                                ) : (
                                <span>Pick a date</span>
                                )}
                            </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={dateRange?.from}
                                selected={dateRange}
                                onSelect={setDateRange}
                                numberOfMonths={2}
                            />
                            </PopoverContent>
                        </Popover>

                        {canFilterEmployees && (
                            <Select value={selectedEmployeeId} onValueChange={setSelectedEmployeeId}>
                                <SelectTrigger className="w-full md:w-[240px]">
                                    <SelectValue placeholder="Select an employee" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Employees</SelectItem>
                                    {(users || []).filter(u => u.role === 'employee').map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </CardContent>
            </Card>
            
            <Card>
                <CardContent className="pt-6">
                    <EmployeeActivityTable timeLogs={filteredLogs} />
                </CardContent>
            </Card>
        </div>
    );
}
