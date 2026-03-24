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
import { MoreHorizontal, GraduationCap, ArrowRightLeft, Repeat, MessageSquare, FilePlus, AlertTriangle, Search, X, ShieldAlert, Calendar, StickyNote, Filter, Globe, ShieldCheck, CheckCircle2, UserPlus, Users, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import type { Student, PipelineStatus, User, Note } from '@/lib/types';
import { useUser } from '@/hooks/use-user';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { updateStudentPipelineStatus, bulkAssignStudents } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { formatRelativeTime, toDate } from '@/lib/timestamp-utils';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { TransferStudentDialog } from '@/components/student/transfer-student-dialog';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface StudentTableProps {
  students: Student[];
  currentUser: any; 
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

export function StudentTable({ students, currentUser: propUser, allUsers, emptyStateMessage = "No students found." }: StudentTableProps) {
  const { toast } = useToast();
  const { user: authUser, effectiveRole } = useUser();
  
  // Use the user from hook to ensure we have the most reactive effectiveRole context
  const currentUser = authUser || propUser;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStatus | 'all'>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'M' | 'F'>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [ieltsFilter, setIeltsFilter] = useState('all');
  const [isClient, setIsClient] = useState(false);
  
  // Smart Routing Filter for Departments
  const [showAllStudents, setShowAllStudents] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
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

  // Identify duplicate phones across all currently loaded students
  const duplicatePhoneSet = useMemo(() => {
    const counts = new Map<string, number>();
    students.forEach(s => {
      if (s.phone) {
        counts.set(s.phone, (counts.get(s.phone) || 0) + 1);
      }
    });
    const duplicates = new Set<string>();
    counts.forEach((count, phone) => {
      if (count > 1) duplicates.add(phone);
    });
    return duplicates;
  }, [students]);

  // Include any user with a Civil ID as a potential agent (Admins/Dept users can also handle cases)
  const employeeOptions = useMemo(() => {
    return allUsers.filter(u => u.civilId && (u.role === 'employee' || u.role === 'admin' || u.role === 'department'));
  }, [allUsers]);

  const employeeMapByCivilId = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach(u => { if(u.civilId) map.set(u.civilId, u); });
    return map;
  }, [allUsers]);

  const displayedStudents = useMemo(() => {
    const filtered = students.filter(student => {
        // Department Routing Logic
        if (effectiveRole === 'department' && !showAllStudents && currentUser.department) {
          const appCountries = (student.applications || []).map(a => a.country);
          const targets = (student.targetCountries || []) as string[];
          const allRelevantCountries = [...appCountries, ...targets];
          
          const dept = currentUser.department;
          const isMatch = (dept === 'UK' && allRelevantCountries.includes('UK')) || 
                          (dept === 'USA' && allRelevantCountries.includes('USA')) || 
                          (dept === 'AU/NZ' && (allRelevantCountries.includes('Australia') || allRelevantCountries.includes('New Zealand')));
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

        // Country filter
        if (countryFilter !== 'all') {
            const hasCountryInApps = (student.applications || []).some(a => a.country === countryFilter);
            const hasCountryInTargets = (student.targetCountries || []).includes(countryFilter as any);
            if (!hasCountryInApps && !hasCountryInTargets) return false;
        }
        
        const matchesGender = genderFilter === 'all' || student.gender === genderFilter;
        
        return matchesSearch && matchesPipeline && matchesEmployee && matchesIelts && matchesGender;
    });

    return [...filtered].sort((a, b) => {
        if (!!a.changeAgentRequired !== !!b.changeAgentRequired) return a.changeAgentRequired ? -1 : 1;
        const getNotificationScore = (s: Student) => {
            let score = 0;
            if (currentUser.role === 'admin' || currentUser.role === 'department') {
                if ((s.unreadUpdates || 0) > 0 && (!s.updatesViewedBy || !s.updatesViewedBy.includes(currentUser.id))) score += s.unreadUpdates || 0;
                if ((s.newDocumentsForAdmin || 0) > 0 && (!s.newDocsViewedBy || !s.newDocsViewedBy.includes(currentUser.id))) score += s.newDocumentsForAdmin || 0;
                if (s.deletionRequested?.status === 'pending') score += 100;
                if (s.transferRequested) score += 80;
            } else if (currentUser.role === 'employee') {
                if ((s.employeeUnreadMessages || 0) > 0 && (!s.updatesViewedBy || !s.updatesViewedBy.includes(currentUser.id))) score += s.employeeUnreadMessages || 0;
                if ((s.newDocumentsForEmployee || 0) > 0 && (!s.newDocsViewedBy || !s.newDocsViewedBy.includes(currentUser.id))) score += s.newDocumentsForEmployee || 0;
                if ((s.newMissingItemsForEmployee || 0) > 0 && (!s.missingItemsViewedBy || !s.missingItemsViewedBy.includes(currentUser.id))) score += s.newMissingItemsForEmployee || 0;
                if (s.isNewForEmployee) score += 50;
            }
            return score;
        };
        const scoreA = getNotificationScore(a);
        const scoreB = getNotificationScore(b);
        
        // 1. If both have flags, sort by the newest flag (lastActivityAt)
        if (scoreA > 0 && scoreB > 0) {
            const timeA = new Date(a.lastActivityAt || a.createdAt).getTime();
            const timeB = new Date(b.lastActivityAt || b.createdAt).getTime();
            if (timeA !== timeB) return timeB - timeA;
            return scoreB - scoreA; // Tie-breaker by score length
        }
        
        // 2. If one has flags and the other doesn't, the flagged one bubbles up
        if (scoreA > 0 && scoreB === 0) return -1;
        if (scoreB > 0 && scoreA === 0) return 1;

        // 3. Otherwise (neither have flags), sort by newly created student (createdAt)
        const dateA = new Date(a.createdAt).getTime() || 0;
        const dateB = new Date(b.createdAt).getTime() || 0;
        return dateB - dateA;
    });
  }, [students, debouncedSearchQuery, pipelineFilter, employeeFilter, ieltsFilter, employeeMapByCivilId, currentUser, showAllStudents, effectiveRole]);

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
        const updates: Partial<Student> = { pipelineStatus: status };
        updateDocumentNonBlocking(studentDocRef, updates);
        toast({ title: 'Status Updated', description: result.message });
    }
  }

  const isAdminDept = ['admin', 'department'].includes(currentUser?.role);
  const isAdminOnly = currentUser?.role === 'admin';

  return (
    <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight">Applicants List</h2>
            <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary border-primary/20 px-3 py-0.5 font-bold animate-in fade-in zoom-in duration-300">
              {displayedStudents.length} Students
            </Badge>
          </div>
        </div>

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
              
              {effectiveRole === 'department' && (
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
                {isClient && effectiveRole !== 'employee' && (
                    <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                        <SelectTrigger className="w-full flex-1"><SelectValue placeholder="Assigned Agent" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Agents</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {employeeOptions.map(emp => (
                                <SelectItem key={emp.id} value={emp.id}>{emp.name} {emp.role !== 'employee' ? `(${emp.role})` : ''}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
                {isClient && (
                  <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger className="w-full md:w-[150px]"><SelectValue placeholder="Country" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Countries</SelectItem>
                      <SelectItem value="UK">UK</SelectItem>
                      <SelectItem value="USA">USA</SelectItem>
                      <SelectItem value="Australia">Australia</SelectItem>
                      <SelectItem value="New Zealand">New Zealand</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                {isClient && (
                  <Select value={genderFilter} onValueChange={(v) => setGenderFilter(v as any)}>
                    <SelectTrigger className="w-full md:w-[150px]"><SelectValue placeholder="Gender" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Genders</SelectItem>
                      <SelectItem value="M">Male (M)</SelectItem>
                      <SelectItem value="F">Female (F)</SelectItem>
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

        {selectedIds.length > 0 && isAdminDept && (
          <div className="mb-4 p-4 bg-muted/30 border-2 border-primary/20 rounded-xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <div className="flex items-center gap-3">
              <div className="bg-primary text-primary-foreground h-8 w-8 rounded-full flex items-center justify-center font-bold text-sm">
                {selectedIds.length}
              </div>
              <div>
                <p className="font-semibold text-sm">Students Selected</p>
                <p className="text-xs text-muted-foreground">You can assign these students to an agent in bulk.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedIds([])} disabled={isAssigning}>Cancel</Button>
              
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" className="gap-2" disabled={isAssigning}>
                    {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                    Assign to Agent
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0" align="end">
                  <div className="p-3 border-b bg-muted/50">
                    <p className="text-sm font-bold flex items-center gap-2"><Users className="h-4 w-4 text-primary" />Select Employee</p>
                  </div>
                  <div className="max-h-[300px] overflow-auto p-1">
                    {employeeOptions.map(emp => (
                      <button
                        key={emp.civilId}
                        className="w-full text-left p-2 hover:bg-muted rounded-md text-sm transition-colors flex items-center justify-between group"
                        onClick={async () => {
                          setIsAssigning(true);
                          const result = await bulkAssignStudents(selectedIds, emp.civilId!, currentUser.id!);
                          setIsAssigning(false);
                          if (result.success) {
                             toast({ title: 'Success', description: result.message });
                             setSelectedIds([]);
                          } else {
                             toast({ variant: 'destructive', title: 'Error', description: result.message });
                          }
                        }}
                      >
                        <div className="flex flex-col">
                           <span className="font-medium">{emp.name}</span>
                           <span className="text-[10px] text-muted-foreground">ID: {emp.civilId}</span>
                        </div>
                        <ArrowRightLeft className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        )}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {isAdminDept && (
                <TableHead className="w-10">
                  <Checkbox 
                    checked={selectedIds.length === displayedStudents.length && displayedStudents.length > 0} 
                    onCheckedChange={(val) => {
                      if (val) setSelectedIds(displayedStudents.map(s => s.id));
                      else setSelectedIds([]);
                    }}
                  />
                </TableHead>
              )}
              <TableHead>Student</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Apps / Target</TableHead>
              <TableHead>Jotform</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Assigned Agent</TableHead>
              <TableHead>Status Note</TableHead>
              {isAdminOnly && <TableHead>Admin Status</TableHead>}
              <TableHead>IELTS Overall</TableHead>
              <TableHead>Intake Term</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedStudents.length > 0 ? (
              displayedStudents.map((student) => {
                const wasTransferred = student.transferHistory?.some(t => t.fromEmployeeId);
                const isCurrentUserAssigned = currentUser.civilId === student.employeeId;
                const isAdminDept = ['admin', 'department'].includes(currentUser.role);
                const requester = student.deletionRequested?.requestedBy ? requesterMap.get(student.deletionRequested.requestedBy) : null;
                const transferRequester = student.transferRequest?.requestedBy ? requesterMap.get(student.transferRequest.requestedBy) : null;
                const canAssign = isAdminDept && !student.employeeId;
                const appCountries = [...new Set(student.applications?.map(app => app.country) || [])];
                const isDuplicate = duplicatePhoneSet.has(student.phone);
                const isUnassigned = !student.employeeId;

                return (
                <TableRow key={student.id} className={cn(student.changeAgentRequired && "bg-red-50/20", selectedIds.includes(student.id) && "bg-primary/5")}>
                  {isAdminDept && (
                    <TableCell>
                      <Checkbox 
                        checked={selectedIds.includes(student.id)} 
                        onCheckedChange={(val) => {
                          setSelectedIds(prev => val ? [...prev, student.id] : prev.filter(id => id !== student.id));
                        }} 
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Link href={`/student/${student.id}`} className="hover:underline">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {student.internalNumber && <Badge variant="secondary" className="font-bold text-[10px] h-5 px-1 bg-muted">#{student.internalNumber}</Badge>}
                          <span>{student.name || 'Unknown Student'}</span>
                          {student.changeAgentRequired && <Badge className="bg-black text-red-500 border-red-500 border animate-pulse uppercase tracking-wider text-[10px] h-5 px-1.5">CHANGE AGENT</Badge>}
                          {isCurrentUserAssigned && student.isNewForEmployee && <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>}
                          {isAdminDept && student.unreadUpdates && (!student.updatesViewedBy || !student.updatesViewedBy.includes(currentUser.id)) ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.unreadUpdates}</span></Badge> : null}
                          {isAdminDept && student.newDocumentsForAdmin && (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForAdmin}</span></Badge> : null}
                          {isCurrentUserAssigned && student.employeeUnreadMessages && (!student.updatesViewedBy || !student.updatesViewedBy.includes(currentUser.id)) ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.employeeUnreadMessages}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newDocumentsForEmployee && (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForEmployee}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newMissingItemsForEmployee && (!student.missingItemsViewedBy || !student.missingItemsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-yellow-500 text-black"><AlertTriangle className="h-3 w-3" /><span>{student.newMissingItemsForEmployee}</span></Badge> : null}
                          {student.transferRequested && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="border-yellow-500 text-yellow-600 cursor-help">
                                    <ArrowRightLeft className="mr-1 h-3 w-3" />
                                    Transfer Requested
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-[250px]">
                                  <p className="text-xs">Reason: "{student.transferRequest?.reason || '...'}"</p>
                                  <p className="text-[10px] text-muted-foreground mt-1">Requested by {transferRequester?.name || 'staff'}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                          {student.deletionRequested?.status === 'pending' && isAdminDept && <TooltipProvider><Tooltip><TooltipTrigger asChild><Badge variant="destructive" className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />Deletion Requested</Badge></TooltipTrigger><TooltipContent><p>Requested by {requester?.name || '...'} {isClient ? formatRelativeTime(student.deletionRequested.requestedAt) : ''}</p></TooltipContent></Tooltip></TooltipProvider>}
                          {wasTransferred && <Badge variant="outline" className="border-blue-500 text-blue-600"><Repeat className="mr-1 h-3 w-3" />Transferred</Badge>}
                        </div>
                      </Link>
                      {isDuplicate && (
                        <div className="flex">
                          <Badge className="bg-blue-900 hover:bg-blue-800 text-white text-[9px] h-4 py-0 font-black uppercase tracking-tighter gap-1">
                            <AlertTriangle className="h-2 w-2" />
                            Duplicate Profile
                          </Badge>
                        </div>
                      )}
                      <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                      <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                      {student.finalChoiceUniversity && <div className="flex items-center gap-1 text-lg text-success font-bold mt-1"><GraduationCap className="h-5 w-5" /><span>{student.finalChoiceUniversity}</span></div>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {student.gender ? (
                      <Badge variant="outline" className={cn(
                        "font-bold text-[11px]",
                        student.gender === 'M' ? "border-blue-200 bg-blue-50 text-blue-700" : "border-pink-200 bg-pink-50 text-pink-700"
                      )}>
                        {student.gender}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isUnassigned && student.targetCountries && student.targetCountries.length > 0 ? (
                      <div className="flex flex-wrap gap-1 max-w-[150px]">
                        {student.targetCountries.map(c => <Badge key={c} variant="secondary" className="text-[10px] px-1.5 h-6 bg-sky-100 text-sky-800 border-sky-200 font-bold">{c}</Badge>)}
                      </div>
                    ) : (
                      <Badge variant="secondary" className="font-mono">{student.applications?.length || 0}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {student.jotform ? (
                      <Badge variant="outline" className="border-green-500 text-green-600 bg-green-50 flex items-center gap-1 w-fit whitespace-nowrap">
                        <CheckCircle2 className="h-3 w-3" />
                        Completed
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">-</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="default" className={cn("capitalize", pipelineStatusStyles[student.pipelineStatus || 'none'])}>{pipelineStatusLabels[student.pipelineStatus || 'none']}</Badge></TableCell>
                  <TableCell>{getEmployeeName(student.employeeId)}</TableCell>
                  <TableCell className="max-w-[200px]">
                    {student.statusNote ? (
                      <div className="flex items-start gap-1.5 py-1">
                        <StickyNote className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0 opacity-70" />
                        <span className="text-[11px] text-muted-foreground whitespace-pre-wrap leading-tight font-medium">{student.statusNote}</span>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic opacity-50">No status set</span>
                    )}
                  </TableCell>
                  {isAdminOnly && (
                    <TableCell className="max-w-[200px]">
                      {student.adminStatusNote ? (
                        <div className="flex items-start gap-1.5 py-1">
                          <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-accent shrink-0" />
                          <span className="text-[11px] text-accent whitespace-pre-wrap leading-tight font-bold">{student.adminStatusNote}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic opacity-30">No admin note</span>
                      )}
                    </TableCell>
                  )}
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
                                {(currentUser?.role === 'employee' || isAdminDept) && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'green')}>Move to Green</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'orange')}>Move to Orange</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'red')}>Move to Red</DropdownMenuItem>
                                  </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            ) : (
              <TableRow><TableCell colSpan={isAdminDept ? (isAdminOnly ? 12 : 11) : (isAdminOnly ? 11 : 10)} className="h-24 text-center">{displayedStudents.length === 0 && isFiltered ? 'No students match your current filters.' : emptyStateMessage}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

