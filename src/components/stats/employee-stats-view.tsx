'use client';

import { useState, useEffect } from 'react';
import type { EmployeeStats } from '@/lib/types';
import { getEmployeeStudentStats } from '@/lib/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';

function EmployeeStatsSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Student Counts</CardTitle>
        <CardDescription>Statistics on student creation by each employee.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <Skeleton className="h-6 w-1/2" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function EmployeeStatsView() {
  const [stats, setStats] = useState<EmployeeStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await getEmployeeStudentStats();
        if (result.success && result.data) {
          setStats(result.data);
        } else {
          setError(result.message || 'Failed to fetch stats.');
        }
      } catch (err: any) {
        setError(err.message || 'An unexpected error occurred.');
      }
      setIsLoading(false);
    }
    fetchStats();
  }, []);

  if (isLoading) {
    return <EmployeeStatsSkeleton />;
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Error</CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Student Counts</CardTitle>
        <CardDescription>Statistics on student creation by each employee.</CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full space-y-4">
          {stats.map(employeeStat => (
            <AccordionItem key={employeeStat.employeeId} value={employeeStat.employeeId} className="border rounded-lg">
              <AccordionTrigger className="px-6 py-4 hover:no-underline">
                <div className="flex items-center gap-4">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  <div className="text-left">
                    <div className="font-semibold text-lg">{employeeStat.employeeName}</div>
                    <div className="text-sm text-muted-foreground">Total Students: {employeeStat.totalStudents}</div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Daily Counts (Last 30 Days)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-72">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Date</TableHead>
                              <TableHead className="text-right">New Students</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {employeeStat.dailyCounts.map(day => (
                              <TableRow key={day.date}>
                                <TableCell>{format(parseISO(day.date), 'MMM d, yyyy')}</TableCell>
                                <TableCell className="text-right font-mono">{day.count}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Monthly Totals</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ScrollArea className="h-72">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Month</TableHead>
                              <TableHead className="text-right">Total Students</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {employeeStat.monthlyTotals.map(month => (
                              <TableRow key={month.month}>
                                <TableCell>{format(parseISO(`${month.month}-02`), 'MMMM yyyy')}</TableCell>
                                <TableCell className="text-right font-mono">{month.count}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </ScrollArea>
                    </CardContent>
                  </Card>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
