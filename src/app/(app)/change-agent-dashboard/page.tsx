'use client';

import { useMemo, useState, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, ChangeAgentLogEntry } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, UserRoundX, ExternalLink, ShieldAlert, User as UserIcon, History, ChevronRight, ChevronDown, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// System sentinel account that closed change-agent profiles get reassigned to.
const SYSTEM_AGENT_ID = '123456789010';

// The current employeeId no longer reflects who "owned" the student when the change
// agent was placed — closing/transferring moves them off the original agent (often onto
// the system sentinel). Reconstruct the original agent from transferHistory so the
// permanent record credits the employee the change was actually placed against.
function originalEmployeeId(student: Student): string | null {
  const transfers = [...(student.transferHistory || [])].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  if (transfers.length === 0) return student.employeeId;

  const flagTimes = (student.changeAgentLog || [])
    .map(e => new Date(e.flaggedAt).getTime())
    .filter(t => !Number.isNaN(t));
  const flaggedTime = flagTimes.length ? Math.min(...flagTimes) : null;

  // Unknown flag time: credit whoever the student was last moved away from.
  if (flaggedTime === null) return transfers[transfers.length - 1].fromEmployeeId;

  // Known flag time: who held the student at that exact moment.
  let current = transfers[0].fromEmployeeId; // owner before the first transfer
  for (const t of transfers) {
    if (new Date(t.date).getTime() <= flaggedTime) current = t.toEmployeeId;
    else break;
  }
  return current;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

interface HistoryStudentRowProps {
  student: Student;
  isClosed: boolean;
}

function HistoryStudentRow({ student, isClosed }: HistoryStudentRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const sortedLog = useMemo(() => {
    return [...(student.changeAgentLog || [])].sort(
      (a, b) => new Date(b.flaggedAt).getTime() - new Date(a.flaggedAt).getTime()
    );
  }, [student.changeAgentLog]);

  // For students flagged before history tracking, synthesise display rows from current universities
  const syntheticUnis = useMemo(() => {
    if (sortedLog.length > 0) return [];
    if (student.changeAgentUniversities && student.changeAgentUniversities.length > 0)
      return student.changeAgentUniversities;
    if (student.changeAgentRequired) return ['General Request'];
    return [];
  }, [sortedLog, student.changeAgentUniversities, student.changeAgentRequired]);

  const totalEvents = sortedLog.length || syntheticUnis.length;
  const hasEvents = totalEvents > 0;

  const latestFlaggedAt = sortedLog[0]?.flaggedAt;

  return (
    <div className="border-b last:border-b-0">
      <div
        className={cn(
          "flex items-center justify-between px-4 py-3 transition-colors",
          hasEvents ? "cursor-pointer hover:bg-muted/30" : "cursor-default"
        )}
        onClick={() => { if (hasEvents) setIsExpanded(!isExpanded); }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasEvents
            ? (isExpanded
                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />)
            : <span className="w-4 shrink-0" />
          }
          <Link
            href={`/student/${student.id}`}
            onClick={e => e.stopPropagation()}
            className="font-black text-sm hover:underline truncate"
          >
            {student.name}
          </Link>
          {student.acceptedInfo && (
            <span
              title={`Accepted (Scholarship): ${student.acceptedInfo.country} · ${student.acceptedInfo.major}`}
              className="inline-flex shrink-0"
            >
              <CheckCircle2 className="h-4 w-4 text-green-600 stroke-[3]" />
            </span>
          )}
          {isClosed && (
            <Badge className="bg-black text-white border-white border uppercase tracking-widest text-[10px] h-5 px-1.5 shrink-0">
              CLOSED
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] h-5 shrink-0">
            {hasEvents ? `${totalEvents} ${totalEvents === 1 ? 'event' : 'events'}` : 'No events'}
          </Badge>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0 ml-2">
          {latestFlaggedAt ? `Latest: ${formatDateShort(latestFlaggedAt)}` : 'Currently Active'}
        </span>
      </div>

      {isExpanded && hasEvents && (
        <div className="bg-muted/10 border-t">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/20 text-muted-foreground uppercase tracking-wider text-[10px]">
                <th className="text-left px-6 py-2 font-bold">University</th>
                <th className="text-left px-4 py-2 font-bold">Flagged By</th>
                <th className="text-left px-4 py-2 font-bold">Date & Time</th>
                <th className="text-left px-4 py-2 font-bold">Status</th>
                <th className="text-left px-4 py-2 font-bold">Note</th>
              </tr>
            </thead>
            <tbody>
              {sortedLog.length > 0
                ? sortedLog.map((entry: ChangeAgentLogEntry) => {
                    const isResolved = !!entry.resolvedAt;
                    const isGone = isClosed && !isResolved;
                    const isActive = !isClosed && !isResolved;
                    return (
                      <tr key={entry.id} className="border-b last:border-b-0 hover:bg-muted/20">
                        <td className="px-6 py-2.5 font-bold">
                          {entry.university === 'General Request'
                            ? <span className="italic text-muted-foreground">General Request</span>
                            : entry.university}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{entry.flaggedByName}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{formatDate(entry.flaggedAt)}</td>
                        <td className="px-4 py-2.5">
                          {isGone && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white bg-black px-2 py-0.5 rounded-full">
                              <XCircle className="h-3 w-3" />Gone
                            </span>
                          )}
                          {isActive && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">
                              <AlertCircle className="h-3 w-3" />Active
                            </span>
                          )}
                          {isResolved && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="h-3 w-3" />Resolved {formatDateShort(entry.resolvedAt!)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground italic">{entry.note || '—'}</td>
                      </tr>
                    );
                  })
                : syntheticUnis.map((uni, idx) => (
                    <tr key={idx} className="border-b last:border-b-0 hover:bg-muted/20">
                      <td className="px-6 py-2.5 font-bold">
                        {uni === 'General Request'
                          ? <span className="italic text-muted-foreground">General Request</span>
                          : uni}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground italic">—</td>
                      <td className="px-4 py-2.5 text-muted-foreground italic">—</td>
                      <td className="px-4 py-2.5">
                        {isClosed
                          ? <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-white bg-black px-2 py-0.5 rounded-full">
                              <XCircle className="h-3 w-3" />Gone
                            </span>
                          : <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-red-700 bg-red-100 px-2 py-0.5 rounded-full animate-pulse">
                              <AlertCircle className="h-3 w-3" />Active
                            </span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground italic">—</td>
                    </tr>
                  ))
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface HistorySectionProps {
  title: string;
  students: Student[];
  isClosed: boolean;
  accentClass: string;
  headerBgClass: string;
  countBadgeClass: string;
}

function HistorySection({ title, students, isClosed, accentClass, headerBgClass, countBadgeClass }: HistorySectionProps) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <Card className={cn('border', accentClass)}>
      <CardHeader
        className={cn('border-b cursor-pointer flex flex-row items-center justify-between py-3', headerBgClass)}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2">
            {title}
          </CardTitle>
          <span className={cn('text-xs font-black px-2 py-0.5 rounded-full', countBadgeClass)}>
            {students.length}
          </span>
        </div>
        {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      </CardHeader>
      {isOpen && (
        <CardContent className="p-0">
          {students.length > 0 ? (
            students.map(student => (
              <HistoryStudentRow key={student.id} student={student} isClosed={isClosed} />
            ))
          ) : (
            <div className="h-16 flex items-center justify-center text-xs text-muted-foreground italic">
              No records found.
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function ChangeAgentDashboard() {
  const { user: currentUser, isUserLoading, effectiveRole } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdminDept = effectiveRole === 'admin' || effectiveRole === 'department';

  // Query active change agent students
  const changeAgentQuery = useMemoFirebase(() => {
    if (!isMounted || !currentUser) return null;
    return query(
      collection(firestore, 'students'),
      where('changeAgentRequired', '==', true),
      orderBy('lastActivityAt', 'desc')
    );
  }, [isMounted, currentUser]);

  const { data: rawStudents, isLoading: studentsLoading } = useCollection<Student>(changeAgentQuery);

  // Query history students (permanent record)
  const historyQuery = useMemoFirebase(() => {
    if (!isMounted || !currentUser) return null;
    return query(
      collection(firestore, 'students'),
      where('hasChangeAgentHistory', '==', true),
      orderBy('lastActivityAt', 'desc')
    );
  }, [isMounted, currentUser]);

  const { data: rawHistoryStudents, isLoading: historyLoading } = useCollection<Student>(historyQuery);

  const applyDeptFilter = (students: Student[]) => {
    if (effectiveRole !== 'department' || !currentUser?.department) return students;
    const dept = currentUser.department;
    return students.filter(student => {
      const flaggedUnis = student.changeAgentUniversities || [];
      const flaggedApps = (student.applications || []).filter(app => flaggedUnis.includes(app.university));
      const flaggedCountries = flaggedApps.map(a => a.country);
      return (dept === 'UK' && flaggedCountries.includes('UK')) ||
             (dept === 'USA' && flaggedCountries.includes('USA')) ||
             (dept === 'AU/NZ' && (flaggedCountries.includes('Australia') || flaggedCountries.includes('New Zealand')));
    });
  };

  const applyHistoryDeptFilter = (students: Student[]) => {
    if (effectiveRole !== 'department' || !currentUser?.department) return students;
    const dept = currentUser.department;
    return students.filter(student => {
      const log = student.changeAgentLog || [];
      const logUnis = log.map(e => e.university);
      const relatedApps = (student.applications || []).filter(app => logUnis.includes(app.university));
      const countries = relatedApps.map(a => a.country);
      return (dept === 'UK' && countries.includes('UK')) ||
             (dept === 'USA' && countries.includes('USA')) ||
             (dept === 'AU/NZ' && (countries.includes('Australia') || countries.includes('New Zealand')));
    });
  };

  const filteredStudents = useMemo(() => {
    if (!rawStudents) return [];
    return applyDeptFilter(rawStudents);
  }, [rawStudents, currentUser, effectiveRole]);

  const { activeHistoryStudents, closedHistoryStudents } = useMemo(() => {
    const historyFiltered = rawHistoryStudents ? applyHistoryDeptFilter(rawHistoryStudents) : [];
    // Merge current active change-agent students so they always appear in history
    const historyMap = new Map<string, Student>(historyFiltered.map(s => [s.id, s]));
    for (const student of filteredStudents) {
      if (!historyMap.has(student.id)) historyMap.set(student.id, student);
    }
    const all = [...historyMap.values()];
    return {
      activeHistoryStudents: all.filter(s => !s.isClosed),
      closedHistoryStudents: all.filter(s => s.isClosed),
    };
  }, [rawHistoryStudents, filteredStudents, currentUser, effectiveRole]);

  const employeeCivilIds = useMemo(() => {
    const ids = [
      ...filteredStudents.map(s => s.employeeId),
      ...activeHistoryStudents.map(s => s.employeeId),
      ...activeHistoryStudents.map(originalEmployeeId),
      ...closedHistoryStudents.map(s => s.employeeId),
      ...closedHistoryStudents.map(originalEmployeeId),
    ].filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [filteredStudents, activeHistoryStudents, closedHistoryStudents]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  // Per-employee breakdown of the permanent record: how many of their change-agent
  // students are still with us (active) vs closed/gone.
  const employeeSummary = useMemo(() => {
    const map = new Map<string, { civilId: string; active: number; closed: number }>();
    const bump = (civilId: string | null | undefined, key: 'active' | 'closed') => {
      const id = civilId || '__unassigned__';
      const entry = map.get(id) || { civilId: id, active: 0, closed: 0 };
      entry[key] += 1;
      map.set(id, entry);
    };
    activeHistoryStudents.forEach(s => bump(originalEmployeeId(s), 'active'));
    closedHistoryStudents.forEach(s => bump(originalEmployeeId(s), 'closed'));

    return [...map.values()]
      .map(e => ({
        civilId: e.civilId,
        name: e.civilId === '__unassigned__'
          ? 'Unassigned'
          : e.civilId === SYSTEM_AGENT_ID
            ? 'System / Closed Bucket'
            : (employeeMap.get(e.civilId)?.name || e.civilId),
        active: e.active,
        closed: e.closed,
        total: e.active + e.closed,
      }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }, [activeHistoryStudents, closedHistoryStudents, employeeMap]);

  const isLoading = isUserLoading || studentsLoading || historyLoading;

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

      {/* Active Change Agent Requests */}
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

      {/* Permanent History Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 pt-2">
          <History className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-xl font-bold tracking-tight">Permanent Change Agent Record</h2>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          A full history of every change agent event. Each student can have multiple entries across different universities and dates. Click a student name to open their profile.
        </p>

        {/* Per-employee breakdown: still with us vs closed/gone */}
        <Card className="border-slate-200">
          <CardHeader className="bg-slate-50/50 border-b py-3">
            <CardTitle className="text-sm font-bold uppercase tracking-widest text-slate-700 flex items-center gap-2">
              <UserIcon className="h-4 w-4" />
              By Employee
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-center">Still With Us</TableHead>
                  <TableHead className="text-center">Closed / Gone</TableHead>
                  <TableHead className="text-center">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeSummary.length > 0 ? (
                  employeeSummary.map(emp => (
                    <TableRow key={emp.civilId} className="hover:bg-muted/20">
                      <TableCell className="font-bold text-sm">{emp.name}</TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center min-w-[2rem] text-xs font-black px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                          {emp.active}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center min-w-[2rem] text-xs font-black px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                          {emp.closed}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center min-w-[2rem] text-xs font-black px-2 py-0.5 rounded-full bg-slate-100 text-slate-800">
                          {emp.total}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-16 text-center text-muted-foreground italic">
                      No records found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <HistorySection
          title="Active Students"
          students={activeHistoryStudents}
          isClosed={false}
          accentClass="border-orange-200"
          headerBgClass="bg-orange-50/30"
          countBadgeClass="bg-orange-100 text-orange-800"
        />

        <HistorySection
          title="Closed / Gone"
          students={closedHistoryStudents}
          isClosed={true}
          accentClass="border-gray-300"
          headerBgClass="bg-gray-50/50"
          countBadgeClass="bg-gray-200 text-gray-700"
        />
      </div>
    </div>
  );
}
