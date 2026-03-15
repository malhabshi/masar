'use client';

import Link from 'next/link';
import { useState, useMemo, useEffect } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreHorizontal, GraduationCap, ArrowRightLeft, Repeat, MessageSquare, FilePlus, AlertTriangle, Search, X, ShieldAlert, Calendar, StickyNote, Filter, Globe } from 'lucide-react';
import type { Student, PipelineStatus, User, Note } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { updateStudentPipelineStatus } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { formatRelativeTime, toDate } from '@/lib/timestamp-utils';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { TransferStudentDialog } from '@/components/student/transfer-student-dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

interface StudentTableProps {
  students: Student[];
  currentUser: AppUser;
  allUsers: User[];
  emptyStateMessage?: string;
}

const pipelineStatusStyles: { [key: string]: string } = {
  green: 'bg-green-500 text-primary-foreground',
  orange: 'bg-orange-500 text-primary-foreground',
  red: 'bg-red-500 text-primary-foreground',
  none: 'bg-gray-400 text-primary-foreground',
};
const pipelineStatusLabels: { [key: string]: string } = {
    green: 'Green',
    orange: 'Orange',
    red: 'Red',
    none: 'No Status',
};

export function StudentTable({ students, currentUser, allUsers, emptyStateMessage = "No students found." }: StudentTableProps) {
  const { toast } = useToast();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStatus | 'all'>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [ieltsFilter, setIeltsFilter] = useState('all');
  const [isClient, setIsClient] = useState(false);
  
  // Smart Routing Filter for Departments
  const [showAllStudents, setShowAllStudents] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const requesters = useMemo(() => {
      const ids = new Set<string>();
      students.forEach(s => {
          if (s.deletionRequested?.requestedBy) ids.add(s.deletionRequested.requestedBy);
          if (s.transferRequest?.requestedBy) ids.add(s.transferRequest.requestedBy);
      });
      return Array.from(ids);
  }, [students]);

  const { userMap: requesterMap } = useUserCacheById(requesters);

  useEffect(() => {
    const handler = setTimeout(() => {
        setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const employeeOptions = useMemo(() => allUsers.filter(u => u.role === 'employee'), [allUsers]);
  const employeeMapByCivilId = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach(u => { if(u.civilId) map.set(u.civilId, u); });
    return map;
  }, [allUsers]);

  const displayedStudents = useMemo(() => {
    const filtered = students.filter(student => {
        // Department Routing Logic
        if (currentUser.role === 'department' && !showAllStudents && currentUser.department) {
          const appCountries = (student.applications || []).map(a => a.country);
          const dept = currentUser.department;
          const isMatch = (dept === 'UK' && appCountries.includes('UK')) || 
                          (dept === 'USA' && appCountries.includes('USA')) || 
                          (dept === 'AU/NZ' && (appCountries.includes('Australia') || appCountries.includes('New Zealand')));
          if (!isMatch) return false;
        }

        const searchLower = debouncedSearchQuery.toLowerCase();
        const matchesSearch = !debouncedSearchQuery || 
            student.name.toLowerCase().includes(searchLower) ||
            (student.email && student.email.toLowerCase().includes(searchLower)) ||
            (student.phone && student.phone.includes(debouncedSearchQuery)) ||
            (student.internalNumber && student.internalNumber.toLowerCase().includes(searchLower));
        
        const matchesPipeline = pipelineFilter === 'all' || student.pipelineStatus === pipelineFilter || (pipelineFilter === 'none' && !student.pipelineStatus);
        const matchesEmployee = employeeFilter === 'all' || (employeeFilter === 'unassigned' && !student.employeeId) || (student.employeeId && employeeMapByCivilId.get(student.employeeId)?.id === employeeFilter);

        const studentIelts = student.ieltsOverall ?? 0;
        let matchesIelts = true;
        if (ieltsFilter !== 'all') {
            switch(ieltsFilter) {
            case '0': matchesIelts = studentIelts === 0; break;
            case '<=5.0': matchesIelts = studentIelts > 0 && studentIelts <= 5.0; break;
            case '5.5': matchesIelts = studentIelts === 5.5; break;
            case '6.0': matchesIelts = studentIelts === 6.0; break;
            case '>=6.5': matchesIelts = studentIelts >= 6.5; break;
            }
        }
        
        return matchesSearch && matchesPipeline && matchesEmployee && matchesIelts;
    });

    return [...filtered].sort((a, b) => {
        if (!!a.changeAgentRequired !== !!b.changeAgentRequired) return a.changeAgentRequired ? -1 : 1;
        const getNotificationScore = (s: Student) => {
            let score = 0;
            if (currentUser.role === 'admin' || currentUser.role === 'department') {
                score += (s.unreadUpdates || 0);
                score += (s.newDocumentsForAdmin || 0);
                if (s.deletionRequested?.status === 'pending') score += 100;
                if (s.transferRequested) score += 80;
            } else if (currentUser.role === 'employee') {
                score += (s.employeeUnreadMessages || 0);
                score += (s.newDocumentsForEmployee || 0);
                score += (s.newMissingItemsForEmployee || 0);
                if (s.isNewForEmployee) score += 50;
            }
            return score;
        };
        const scoreA = getNotificationScore(a);
        const scoreB = getNotificationScore(b);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const dateA = new Date(a.createdAt).getTime() || 0;
        const dateB = new Date(b.createdAt).getTime() || 0;
        return dateB - dateA;
    });
  }, [students, debouncedSearchQuery, pipelineFilter, employeeFilter, ieltsFilter, employeeMapByCivilId, currentUser, showAllStudents]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setPipelineFilter('all');
    setEmployeeFilter('all');
    setIeltsFilter('all');
    setShowAllStudents(false);
  };
  const isFiltered = searchQuery || pipelineFilter !== 'all' || employeeFilter !== 'all' || ieltsFilter !== 'all' || showAllStudents;

  const getEmployeeName = (employeeId: string | null) => {
    if (!employeeId) return 'Unassigned';
    return employeeMapByCivilId.get(employeeId)?.name || '...';
  };

  const handlePipelineStatusChange = async (studentId: string, status: PipelineStatus) => {
    const student = students.find(s => s.id === studentId);
    if (!student || !currentUser || !firestore) return;
    const result = await updateStudentPipelineStatus(studentId, status, currentUser.name, student.name);
    if (result.success) {
        const studentDocRef = doc(firestore, 'students', studentId);
        updateDocumentNonBlocking(studentDocRef, { pipelineStatus: status });
        toast({ title: 'Status Updated', description: result.message });
    }
  }

  return (
    <div>
        <div className="flex flex-col gap-4 mb-4">
            <div className="flex flex-col md:flex-row items-center gap-4">
              <div className="relative w-full">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                      placeholder="Search by name, email, internal number or phone..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 w-full"
                  />
              </div>
              
              {currentUser.role === 'department' && (
                <div className="flex items-center space-x-2 shrink-0 bg-muted/50 p-2 rounded-lg border">
                  <Switch 
                    id="show-all" 
                    checked={showAllStudents} 
                    onCheckedChange={setShowAllStudents} 
                  />
                  <Label htmlFor="show-all" className="text-xs font-bold whitespace-nowrap flex items-center gap-1.5">
                    <Globe className="h-3 w-3" />
                    Show All Students
                  </Label>
                </div>
              )}
            </div>

            <div className="flex flex-col md:flex-row gap-2 items-center">
                <Select value={pipelineFilter} onValueChange={(v) => setPipelineFilter(v as any)}>
                    <SelectTrigger className="w-full flex-1"><SelectValue placeholder="Pipeline Status" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Pipelines</SelectItem>
                        <SelectItem value="none">No Status</SelectItem>
                        <SelectItem value="green">Green</SelectItem>
                        <SelectItem value="orange">Orange</SelectItem>
                        <SelectItem value="red">Red</SelectItem>
                    </SelectContent>
                </Select>
                {isClient && currentUser.role !== 'employee' && (
                    <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                        <SelectTrigger className="w-full flex-1"><SelectValue placeholder="Assigned Employee" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Employees</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {employeeOptions.map(emp => (
                                <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                <Select value={ieltsFilter} onValueChange={setIeltsFilter}>
                    <SelectTrigger className="w-full flex-1"><SelectValue placeholder="IELTS Score" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Scores</SelectItem>
                        <SelectItem value="0">0</SelectItem>
                        <SelectItem value="<=5.0">5.0 or less</SelectItem>
                        <SelectItem value="5.5">5.5</SelectItem>
                        <SelectItem value="6.0">6.0</SelectItem>
                        <SelectItem value=">=6.5">6.5+</SelectItem>
                    </SelectContent>
                </Select>
                {isFiltered && <Button variant="ghost" onClick={handleClearFilters} className="w-full md:w-auto"><X className="mr-2 h-4 w-4" /> Clear Filters</Button>}
            </div>
        </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              <TableHead>Apps</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Assigned Employee</TableHead>
              <TableHead>Status Note</TableHead>
              <TableHead>IELTS Overall</TableHead>
              <TableHead>Intake Term</TableHead>
              <TableHead>App. Countries</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedStudents.length > 0 ? (
              displayedStudents.map((student) => {
                const wasTransferred = student.transferHistory?.some(t => t.fromEmployeeId);
                const isCurrentUserAssigned = currentUser.civilId === student.employeeId;
                const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);
                const requester = student.deletionRequested?.requestedBy ? requesterMap.get(student.deletionRequested.requestedBy) : null;
                const transferRequester = student.transferRequest?.requestedBy ? requesterMap.get(student.transferRequest.requestedBy) : null;
                const canAssign = isAdminOrDept && !student.employeeId;
                const appCountries = [...new Set(student.applications?.map(app => app.country) || [])];

                return (
                <TableRow key={student.id} className={cn(student.changeAgentRequired && "bg-red-50/20")}>
                  <TableCell>
                    <div>
                      <Link href={`/student/${student.id}`} className="hover:underline">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {student.internalNumber && <Badge variant="secondary" className="font-bold text-[10px] h-5 px-1 bg-muted">#{student.internalNumber}</Badge>}
                          <span>{student.name || 'Unknown Student'}</span>
                          {student.changeAgentRequired && <Badge className="bg-black text-red-500 border-red-500 border animate-pulse uppercase tracking-wider text-[10px] h-5 px-1.5">CHANGE AGENT</Badge>}
                          {isCurrentUserAssigned && student.isNewForEmployee && <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>}
                          {isAdminOrDept && student.unreadUpdates ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.unreadUpdates}</span></Badge> : null}
                          {isAdminOrDept && student.newDocumentsForAdmin ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForAdmin}</span></Badge> : null}
                          {isCurrentUserAssigned && student.employeeUnreadMessages ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.employeeUnreadMessages}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newDocumentsForEmployee ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForEmployee}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newMissingItemsForEmployee ? <Badge className="flex items-center gap-1 p-1 h-6 bg-yellow-500 text-black"><AlertTriangle className="h-3 w-3" /><span>{student.newMissingItemsForEmployee}</span></Badge> : null}
                          {student.transferRequested && <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="outline" className="border-yellow-500 text-yellow-600 cursor-help"><ArrowRightLeft className="mr-1 h-3 w-3" />Transfer Requested</Badge></TooltipTrigger><TooltipContent className="max-w-[250px]"><p className="text-xs">Reason: "{student.transferRequest?.reason || '...'}"</p><p className="text-[10px] text-muted-foreground mt-1">Requested by {transferRequester?.name || 'employee'}</p></TooltipContent></Tooltip></TooltipProvider>}
                          {student.deletionRequested?.status === 'pending' && isAdminOrDept && <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="destructive" className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Deletion Requested</Badge></TooltipTrigger><TooltipContent><p>Requested by {requester?.name || '...'} {isClient ? formatRelativeTime(student.deletionRequested.requestedAt) : ''}</p></TooltipContent></Tooltip></TooltipProvider>}
                          {wasTransferred && <Badge variant="outline" className="border-blue-500 text-blue-600"><Repeat className="mr-1 h-3 w-3" />Transferred</Badge>}
                        </div>
                      </Link>
                      <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                      <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                      {student.finalChoiceUniversity && <div className="flex items-center gap-1 text-lg text-success font-bold mt-1"><GraduationCap className="h-5 w-5" /><span>{student.finalChoiceUniversity}</span></div>}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="font-mono">{student.applications?.length || 0}</Badge></TableCell>
                  <TableCell><Badge variant="default" className={cn("capitalize", pipelineStatusStyles[student.pipelineStatus || 'none'])}>{pipelineStatusLabels[student.pipelineStatus || 'none']}</Badge></TableCell>
                  <TableCell>{getEmployeeName(student.employeeId)}</TableCell>
                  <TableCell>
                    {student.statusNote ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-start gap-1.5 max-w-[150px] cursor-help group">
                              <StickyNote className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0 opacity-50 group-hover:opacity-100" />
                              <span className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">{student.statusNote}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[300px] p-3">
                            <p className="font-bold text-[10px] uppercase mb-1 text-primary">Current Status Note:</p>
                            <p className="text-xs whitespace-pre-wrap">{student.statusNote}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic opacity-50">No status set</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant={student.ieltsOverall ? 'secondary' : 'outline'}>{(student.ieltsOverall ?? 0).toFixed(1)}</Badge></TableCell>
                  <TableCell>{student.academicIntakeSemester ? <div className="flex items-center gap-1.5 whitespace-nowrap"><Calendar className="h-3 w-3 text-primary" /><span className="text-sm font-medium">{student.academicIntakeSemester} {student.academicIntakeYear}</span></div> : <span className="text-xs text-muted-foreground italic">None</span>}</TableCell>
                  <TableCell>{appCountries.length > 0 ? <div className="flex flex-wrap gap-1 max-w-[120px]">{appCountries.map(c => <Badge key={c} variant="outline" className="text-[10px] px-1 h-5">{c}</Badge>)}</div> : <span className="text-xs text-muted-foreground italic">None</span>}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                        {canAssign && <TransferStudentDialog student={student} employees={employeeOptions} currentUser={currentUser} actionType="assign" />}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild><Link href={`/student/${student.id}`}>View Details</Link></DropdownMenuItem>
                                {currentUser?.role === 'employee' && (<><DropdownMenuSeparator /><DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'green')}>Move to Green</DropdownMenuItem><DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'orange')}>Move to Orange</DropdownMenuItem><DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'red')}>Move to Red</DropdownMenuItem></>)}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            ) : (
              <TableRow><TableCell colSpan={9} className="h-24 text-center">{displayedStudents.length === 0 && isFiltered ? 'No students match your current filters.' : emptyStateMessage}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
