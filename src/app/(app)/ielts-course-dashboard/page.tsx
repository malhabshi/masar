
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Task } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar as CalendarIcon, Download, FileSpreadsheet, Loader2, Search } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { toDate, formatDate } from '@/lib/timestamp-utils';
import { markMultipleTasksAsSeen } from '@/lib/actions';

export default function IeltsCourseDashboard() {
  const { user: currentUser } = useUser();
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch only formal requests
  const ieltsCourseConstraints = useMemoFirebase(() => {
    if (!currentUser) return [];
    return [where('category', '==', 'request')];
  }, [currentUser]);

  const { data: tasks, isLoading } = useCollection<Task>(
    currentUser ? 'tasks' : '',
    ...ieltsCourseConstraints
  );

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    
    return tasks.filter((task) => {
      // ✅ Stable check: Use programmatic markers (Marker 1 & 2)
      // String matching kept as fallback for legacy data only (Marker 3)
      const isIeltsCourse = 
        task.data?.examType === 'ielts_course' || 
        task.requestTypeId === 'ielts_course' ||
        task.taskType?.toLowerCase() === 'ielts course';
      
      if (!isIeltsCourse) return false;

      const data = task.data || {};
      const courseDate = toDate(data.courseStartDate);
      
      // Date Filter
      if (dateRange.from && dateRange.to && courseDate) {
        const isInRange = isWithinInterval(courseDate, {
          start: startOfDay(dateRange.from),
          end: endOfDay(dateRange.to),
        });
        if (!isInRange) return false;
      }

      // Search Filter
      const query = searchQuery.toLowerCase();
      return (
        task.studentName?.toLowerCase().includes(query) ||
        task.studentPhone?.includes(query) ||
        data.studentEmail?.toLowerCase().includes(query) ||
        data.courseOption?.toLowerCase().includes(query)
      );
    });
  }, [tasks, dateRange, searchQuery]);

  // Mark all visible "new" tasks as seen automatically when they appear in the table
  useEffect(() => {
    if (currentUser && filteredTasks.length > 0) {
      const unseenIds = filteredTasks
        .filter(t => t.status === 'new' && !t.viewedBy?.some(v => v.userId === currentUser.id))
        .map(t => t.id);
      
      if (unseenIds.length > 0) {
        markMultipleTasksAsSeen(unseenIds, currentUser.id, currentUser.name);
      }
    }
  }, [filteredTasks, currentUser]);

  const handleDownloadExcel = () => {
    if (filteredTasks.length === 0) return;

    // CSV Headers
    const headers = ["Student Name", "Phone Number", "Email", "Course Type", "Exam Date", "Employee Name"];
    
    // CSV Content
    const rows = filteredTasks.map(task => [
      task.studentName || '',
      task.studentPhone || '',
      task.data?.studentEmail || '',
      task.data?.courseOption || '',
      task.data?.courseStartDate ? format(toDate(task.data.courseStartDate)!, 'yyyy-MM-dd') : '',
      task.authorName || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ielts_courses_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Restricted to ADMIN ONLY
  if (!currentUser || currentUser.role !== 'admin') {
    return <div className="p-8 text-center text-muted-foreground">Access Denied. This dashboard is for administrators only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">IELTS Course Dashboard</h1>
          <p className="text-muted-foreground mt-1">Track and manage specialized IELTS training registrations.</p>
        </div>
        <Button onClick={handleDownloadExcel} variant="outline" className="gap-2 border-green-600 text-green-700 hover:bg-green-50">
          <FileSpreadsheet className="h-4 w-4" />
          Download Excel
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <Label>Search Registrations</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by student name or phone..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Filter by Date</Label>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[180px] justify-start text-left font-normal", !dateRange.from && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.from ? format(dateRange.from, "PPP") : "From Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateRange.from} onSelect={(d) => setDateRange(prev => ({ ...prev, from: d }))} initialFocus />
                  </PopoverContent>
                </Popover>
                
                <span className="text-muted-foreground">to</span>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-[180px] justify-start text-left font-normal", !dateRange.to && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange.to ? format(dateRange.to, "PPP") : "To Date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateRange.to} onSelect={(d) => setDateRange(prev => ({ ...prev, to: d }))} initialFocus />
                  </PopoverContent>
                </Popover>

                {(dateRange.from || dateRange.to) && (
                  <Button variant="ghost" onClick={() => setDateRange({ from: undefined, to: undefined })}>Clear</Button>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Phone Number</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Course Type</TableHead>
                    <TableHead>Start Date</TableHead>
                    <TableHead>Employee Name</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell className="font-bold">{task.studentName}</TableCell>
                        <TableCell>{task.studentPhone}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{task.data?.studentEmail || 'N/A'}</TableCell>
                        <TableCell>
                          <span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs font-semibold">
                            {task.data?.courseOption || 'General'}
                          </span>
                        </TableCell>
                        <TableCell className="font-medium text-blue-600">
                          {task.data?.courseStartDate ? formatDate(task.data.courseStartDate) : 'N/A'}
                        </TableCell>
                        <TableCell>{task.authorName}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                        No IELTS Course registrations found for the selected criteria.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
