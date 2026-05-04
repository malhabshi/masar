'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { Task } from '@/lib/types';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileSpreadsheet, Loader2, Search } from 'lucide-react';
import { format } from 'date-fns';
import { markMultipleTasksAsSeen } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

export default function UnifiedExamDashboard() {
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDate, setSelectedDate] = useState('all');

  const constraints = useMemoFirebase(() => {
    if (!currentUser) return [];
    return [where('category', '==', 'request')];
  }, [currentUser]);

  const { data: tasks, isLoading } = useCollection<Task>(
    currentUser ? 'tasks' : '',
    ...constraints
  );

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    return tasks
      .filter((task) => {
        const isUnifiedExam =
          task.data?.examType === 'unified_exam' ||
          task.taskType?.toLowerCase() === 'unified exam';
        if (!isUnifiedExam) return false;

        if (selectedDate !== 'all' && task.data?.unifiedExamDateId !== selectedDate) return false;

        const q = searchQuery.toLowerCase();
        return (
          !q ||
          task.studentName?.toLowerCase().includes(q) ||
          task.studentPhone?.includes(q) ||
          task.data?.studentEmail?.toLowerCase().includes(q) ||
          task.authorName?.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks, searchQuery, selectedDate]);

  // Collect unique dates for the filter dropdown
  const availableDates = useMemo(() => {
    const map = new Map<string, string>();
    (tasks || []).forEach((t) => {
      if ((t.data?.examType === 'unified_exam' || t.taskType?.toLowerCase() === 'unified exam') && t.data?.unifiedExamDateId) {
        map.set(t.data.unifiedExamDateId, t.data.unifiedExamDateLabel || t.data.unifiedExamDateId);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [tasks]);

  useEffect(() => {
    if (currentUser && filteredTasks.length > 0) {
      const unseenIds = filteredTasks
        .filter((t) => t.status === 'new' && !t.viewedBy?.some((v) => v.userId === currentUser.id))
        .map((t) => t.id);
      if (unseenIds.length > 0) markMultipleTasksAsSeen(unseenIds, currentUser.id, currentUser.name);
    }
  }, [filteredTasks, currentUser]);

  const handleDownload = () => {
    if (filteredTasks.length === 0) return;

    const headers = ['Student Name', 'Phone Number', 'Email', 'Employee Name', 'Exam Date', 'Delivery Method'];
    const rows = filteredTasks.map((task) => [
      task.studentName || '',
      task.studentPhone || '',
      task.data?.studentEmail || '',
      task.authorName || '',
      task.data?.unifiedExamDateLabel || task.data?.unifiedExamDateId || '',
      task.data?.unifiedExamDelivery || '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `unified_exam_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!currentUser || !['admin', 'adminplus'].includes(currentUser.role)) {
    return <div className="p-8 text-center text-muted-foreground">Access Denied. Administrators only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Unified Exam Dashboard</h1>
          <p className="text-muted-foreground mt-1">Track all unified exam registrations submitted by staff.</p>
        </div>
        <Button onClick={handleDownload} variant="outline" className="gap-2 border-green-600 text-green-700 hover:bg-green-50" disabled={filteredTasks.length === 0}>
          <FileSpreadsheet className="h-4 w-4" />
          Download Excel
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 space-y-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by student name, phone, email, or employee..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1 min-w-[220px]">
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
              >
                <option value="all">All Exam Dates</option>
                {availableDates.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
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
                    <TableHead>#</TableHead>
                    <TableHead>Student Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Exam Date</TableHead>
                    <TableHead>Delivery</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTasks.length > 0 ? (
                    filteredTasks.map((task, i) => (
                      <TableRow key={task.id}>
                        <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="font-bold">{task.studentName}</TableCell>
                        <TableCell>{task.studentPhone}</TableCell>
                        <TableCell className="text-muted-foreground text-xs">{task.data?.studentEmail || 'N/A'}</TableCell>
                        <TableCell>{task.authorName}</TableCell>
                        <TableCell className="font-medium text-blue-600">
                          {task.data?.unifiedExamDateLabel || task.data?.unifiedExamDateId || 'N/A'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={task.data?.unifiedExamDelivery === 'Online' ? 'secondary' : 'outline'}>
                            {task.data?.unifiedExamDelivery || 'N/A'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                        No unified exam registrations found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
          {filteredTasks.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3 text-right">{filteredTasks.length} registrations</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
