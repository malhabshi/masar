'use client';

import { useMemo, useState, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserRoundX, ExternalLink, ShieldAlert, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export default function ChangeAgentDashboard() {
  const { user: currentUser, isUserLoading, effectiveRole } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdminDept = effectiveRole === 'admin' || effectiveRole === 'department';

  // Query only students with changeAgentRequired: true
  const changeAgentQuery = useMemoFirebase(() => {
    if (!isMounted || !currentUser) return null;
    return query(
      collection(firestore, 'students'),
      where('changeAgentRequired', '==', true),
      orderBy('lastActivityAt', 'desc')
    );
  }, [isMounted, currentUser]);

  const { data: rawStudents, isLoading: studentsLoading } = useCollection<Student>(changeAgentQuery);

  const filteredStudents = useMemo(() => {
    if (!rawStudents) return [];
    
    // Regional Filtering for Departments
    // PRECISION ROUTING: Only show students if one of their FLAGGED universities belongs to this region
    if (effectiveRole === 'department' && currentUser?.department) {
      const dept = currentUser.department;
      return rawStudents.filter(student => {
        const flaggedUnis = student.changeAgentUniversities || [];
        const flaggedApps = (student.applications || []).filter(app => flaggedUnis.includes(app.university));
        
        const flaggedCountries = flaggedApps.map(a => a.country);
        
        return (dept === 'UK' && flaggedCountries.includes('UK')) || 
               (dept === 'USA' && flaggedCountries.includes('USA')) || 
               (dept === 'AU/NZ' && (flaggedCountries.includes('Australia') || flaggedCountries.includes('New Zealand')));
      });
    }

    return rawStudents;
  }, [rawStudents, currentUser, effectiveRole]);

  // Fetch unique employee IDs for name mapping
  const employeeCivilIds = useMemo(() => {
    return [...new Set(filteredStudents.map(s => s.employeeId).filter((id): id is string => !!id))];
  }, [filteredStudents]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  const isLoading = isUserLoading || studentsLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!currentUser || !isAdminDept) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>Only administrators and department users can access this dashboard.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <UserRoundX className="h-8 w-8 text-red-600" />
            Change Agent Monitoring
          </h1>
          <p className="text-muted-foreground mt-1">
            Tracking {filteredStudents.length} students requiring high-priority management oversight.
          </p>
        </div>
      </div>

      <Card className="border-red-200">
        <CardHeader className="bg-red-50/30 border-b">
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-red-800 flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" />
            Active Change Agent Requests
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>Student Name</TableHead>
                <TableHead>Assigned Agent</TableHead>
                <TableHead>Requested Schools (Country)</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredStudents.length > 0 ? (
                filteredStudents.map((student) => {
                  const employee = student.employeeId ? employeeMap.get(student.employeeId) : null;
                  
                  return (
                    <TableRow key={student.id} className="group hover:bg-red-50/10">
                      <TableCell>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-sm">{student.name}</span>
                            {student.internalNumber && (
                              <Badge variant="outline" className="text-[10px] h-5 bg-muted font-mono">
                                #{student.internalNumber}
                              </Badge>
                            )}
                          </div>
                          <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-tighter">
                            Added: {new Date(student.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <UserIcon className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-bold">{employee?.name || 'Unassigned'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[400px]">
                        <div className="flex flex-wrap gap-1.5">
                          {student.changeAgentUniversities && student.changeAgentUniversities.length > 0 ? (
                            student.changeAgentUniversities.map((uni, idx) => {
                              const app = student.applications?.find(a => a.university === uni);
                              return (
                                <Badge key={idx} className="bg-black text-red-500 border border-red-500 text-[10px] py-0.5 font-bold uppercase">
                                  {uni} {app ? `(${app.country})` : ''}
                                </Badge>
                              );
                            })
                          ) : (
                            <span className="text-xs italic text-muted-foreground">General request (No specific schools)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild className="text-primary font-bold gap-1">
                          <Link href={`/student/${student.id}`}>
                            View Profile
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-muted-foreground italic">
                    No active change agent requests found for your region.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}