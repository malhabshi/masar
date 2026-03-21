'use client';

import { useState, useEffect } from 'react';
import type { EmployeeStats } from '@/lib/types';
import { getEmployeeStudentStats } from '@/lib/actions';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart, Users, PieChart, CheckCircle2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

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
        <CardTitle>Employee Portfolio Statistics</CardTitle>
        <CardDescription>Performance tracking and real-time pipeline status for each agent.</CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple" className="w-full space-y-4">
          {stats.map(employeeStat => (
            <AccordionItem key={employeeStat.employeeId} value={employeeStat.employeeId} className="border rounded-lg shadow-sm overflow-hidden">
              <AccordionTrigger className="px-6 py-4 hover:no-underline bg-muted/5">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {employeeStat.employeeName.charAt(0)}
                  </div>
                  <div className="text-left">
                    <div className="font-bold text-lg leading-none mb-1">{employeeStat.employeeName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2">
                      <Users className="h-3 w-3" />
                      Total Lifetime Creations: {employeeStat.totalStudents}
                    </div>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-6 pb-6 pt-4">
                <div className="space-y-6">
                  {/* Pipeline Breakdown Card */}
                  <Card className="border-primary/10 bg-primary/5">
                    <CardHeader className="py-3 border-b">
                      <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        Live Portfolio Pipeline
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="py-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-green-700 uppercase">Green</span>
                          <div className="text-2xl font-black text-green-700">{employeeStat.pipelineBreakdown.green}</div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-orange-700 uppercase">Orange</span>
                          <div className="text-2xl font-black text-orange-700">{employeeStat.pipelineBreakdown.orange}</div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-red-700 uppercase">Red</span>
                          <div className="text-2xl font-black text-red-700">{employeeStat.pipelineBreakdown.red}</div>
                        </div>
                        <div className="space-y-1">
                          <span className="text-[10px] font-black text-muted-foreground uppercase">No Status</span>
                          <div className="text-2xl font-black text-muted-foreground">{employeeStat.pipelineBreakdown.none}</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader className="py-3 border-b">
                        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Daily Counts (Last 30 Days)</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="h-64">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="text-[10px] uppercase font-bold">Date</TableHead>
                                <TableHead className="text-right text-[10px] uppercase font-bold">New Students</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {employeeStat.dailyCounts.length > 0 ? (
                                employeeStat.dailyCounts.slice().reverse().map(day => (
                                  <TableRow key={day.date} className={cn(day.count > 0 && "bg-blue-50/30")}>
                                    <TableCell className="text-xs font-medium">{format(parseISO(day.date), 'MMM d, yyyy')}</TableCell>
                                    <TableCell className="text-right font-mono font-bold">{day.count}</TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow><TableCell colSpan={2} className="text-center py-10 text-muted-foreground italic text-xs">No recent activity</TableCell></TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="py-3 border-b">
                        <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Monthly Creation Totals</CardTitle>
                      </CardHeader>
                      <CardContent className="p-0">
                        <ScrollArea className="h-64">
                          <Table>
                            <TableHeader>
                              <TableRow className="hover:bg-transparent">
                                <TableHead className="text-[10px] uppercase font-bold">Month</TableHead>
                                <TableHead className="text-right text-[10px] uppercase font-bold">Total Students</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {employeeStat.monthlyTotals.length > 0 ? (
                                employeeStat.monthlyTotals.slice().reverse().map(month => (
                                  <TableRow key={month.month}>
                                    <TableCell className="text-xs font-medium uppercase">{format(parseISO(`${month.month}-02`), 'MMMM yyyy')}</TableCell>
                                    <TableCell className="text-right font-mono font-bold">{month.count}</TableCell>
                                  </TableRow>
                                ))
                              ) : (
                                <TableRow><TableCell colSpan={2} className="text-center py-10 text-muted-foreground italic text-xs">No records found</TableCell></TableRow>
                              )}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}
