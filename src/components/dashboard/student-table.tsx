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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel, SelectSeparator } from '@/components/ui/select';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { MoreHorizontal, GraduationCap, ArrowRightLeft, Repeat, MessageSquare, FilePlus, AlertTriangle, Search, X, ShieldAlert, Calendar, StickyNote, Filter, Globe, ShieldCheck, CheckCircle2, UserPlus, Users, Check, ChevronsUpDown, Loader2, Upload, Bell } from 'lucide-react';
import type { Student, PipelineStatus, User, Note, ChecklistConfigItem } from '@/lib/types';
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
import { updateStudentPipelineStatus, bulkAssignStudents, getChecklistConfig, getAdminChecklistConfig } from '@/lib/actions';
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
  yellow: 'bg-yellow-400 text-black',
  orange: 'bg-orange-500 text-primary-foreground',
  red: 'bg-red-500 text-primary-foreground',
  black: 'bg-black text-white',
  none: 'bg-gray-400 text-primary-foreground',
};
const pipelineStatusLabels: { [key: string]: string } = {
    green: 'Green',
    yellow: 'Yellow',
    orange: 'Orange',
    red: 'Red',
    black: 'Black',
    none: 'No Status',
};

export function StudentTable({ students, currentUser: propUser, allUsers, emptyStateMessage = "No students found." }: StudentTableProps) {
  const { toast } = useToast();
  const { user: authUser, effectiveRole } = useUser();
  
  // Use the user from hook to ensure we have the most reactive effectiveRole context
  const currentUser = authUser || propUser;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<string[]>([]);
  const [employeeFilter, setEmployeeFilter] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string[]>([]);
  const [studyLevelFilter, setStudyLevelFilter] = useState<string[]>([]);
  const [schoolTypeFilter, setSchoolTypeFilter] = useState<string[]>([]);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [ieltsFilter, setIeltsFilter] = useState('all');
  const [importTypeFilter, setImportTypeFilter] = useState('all');
  const [acceptedFilter, setAcceptedFilter] = useState('all');
  const [acceptedCountryFilter, setAcceptedCountryFilter] = useState<string[]>([]);
  const [acceptedMajorFilter, setAcceptedMajorFilter] = useState<string[]>([]);
  const [isClient, setIsClient] = useState(false);

  // Checklist filters
  const [checklistItemFilter, setChecklistItemFilter] = useState('all');
  const [checklistStatusFilter, setChecklistStatusFilter] = useState<'all' | 'checked' | 'unchecked'>('all');
  const [readinessChecklistItems, setReadinessChecklistItems] = useState<ChecklistConfigItem[]>([]);
  const [adminChecklistItems, setAdminChecklistItems] = useState<ChecklistConfigItem[]>([]);

  // Smart Routing Filter for Departments
  const [showAllStudents, setShowAllStudents] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    Promise.all([getChecklistConfig(), getAdminChecklistConfig()]).then(([readiness, admin]) => {
      setReadinessChecklistItems(readiness);
      setAdminChecklistItems(admin);
    });
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setPipelineFilter([]);
    setEmployeeFilter([]);
    setGenderFilter([]);
    setStudyLevelFilter([]);
    setSchoolTypeFilter([]);
    setCountryFilter([]);
    setIeltsFilter('all');
    setImportTypeFilter('all');
    setAcceptedFilter('all');
    setAcceptedCountryFilter([]);
    setAcceptedMajorFilter([]);
    setShowAllStudents(false);
    try {
      const raw = sessionStorage.getItem(`applicants_filters_${currentUser.id}`);
      if (raw) {
        const f = JSON.parse(raw);
        if (f.searchQuery !== undefined)       { setSearchQuery(f.searchQuery); setDebouncedSearchQuery(f.searchQuery); }
        if (Array.isArray(f.pipelineFilter))   setPipelineFilter(f.pipelineFilter);
        if (Array.isArray(f.employeeFilter))   setEmployeeFilter(f.employeeFilter);
        if (Array.isArray(f.genderFilter))     setGenderFilter(f.genderFilter);
        if (Array.isArray(f.studyLevelFilter))   setStudyLevelFilter(f.studyLevelFilter);
        if (Array.isArray(f.schoolTypeFilter))   setSchoolTypeFilter(f.schoolTypeFilter);
        if (Array.isArray(f.countryFilter))      setCountryFilter(f.countryFilter);
        if (f.ieltsFilter !== undefined)           setIeltsFilter(f.ieltsFilter);
        if (f.importTypeFilter !== undefined)      setImportTypeFilter(f.importTypeFilter);
        if (f.acceptedFilter !== undefined)        setAcceptedFilter(f.acceptedFilter);
        if (Array.isArray(f.acceptedCountryFilter)) setAcceptedCountryFilter(f.acceptedCountryFilter);
        if (Array.isArray(f.acceptedMajorFilter))   setAcceptedMajorFilter(f.acceptedMajorFilter);
        if (f.showAllStudents !== undefined)       setShowAllStudents(f.showAllStudents);
        if (f.checklistItemFilter !== undefined)   setChecklistItemFilter(f.checklistItemFilter);
        if (f.checklistStatusFilter !== undefined) setChecklistStatusFilter(f.checklistStatusFilter);
      }
    } catch {}
  }, [currentUser?.id]);

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

  useEffect(() => {
    if (!isClient || !currentUser?.id) return;
    try {
      sessionStorage.setItem(`applicants_filters_${currentUser.id}`, JSON.stringify({
        searchQuery, pipelineFilter, employeeFilter,
        genderFilter, studyLevelFilter, schoolTypeFilter, countryFilter, ieltsFilter, importTypeFilter, acceptedFilter, acceptedCountryFilter, acceptedMajorFilter, showAllStudents,
        checklistItemFilter, checklistStatusFilter,
      }));
    } catch {}
  }, [isClient, currentUser?.id, searchQuery, pipelineFilter, employeeFilter, genderFilter, studyLevelFilter, countryFilter, ieltsFilter, importTypeFilter, acceptedFilter, acceptedCountryFilter, acceptedMajorFilter, showAllStudents, checklistItemFilter, checklistStatusFilter]);

  // Identify duplicate phones across all currently loaded students (all phone fields)
  const duplicatePhoneSet = useMemo(() => {
    const counts = new Map<string, number>();
    students.forEach(s => {
      [s.phone, s.phone2, s.phone3].filter(Boolean).forEach(p => {
        counts.set(p!, (counts.get(p!) || 0) + 1);
      });
    });
    const duplicates = new Set<string>();
    counts.forEach((count, phone) => {
      if (count > 1) duplicates.add(phone);
    });
    return duplicates;
  }, [students]);

  // Include any user with a Civil ID as a potential agent (Admins/Dept users can also handle cases)
  const acceptedCountryOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { const c = s.acceptedInfo?.country?.trim(); if (c) set.add(c); });
    return [...set].sort().map(c => ({ label: c, value: c }));
  }, [students]);
  const acceptedMajorOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach(s => { const m = s.acceptedInfo?.major?.trim(); if (m) set.add(m); });
    return [...set].sort().map(m => ({ label: m, value: m }));
  }, [students]);

  const employeeOptions = useMemo(() => {
    return allUsers.filter(u => u.civilId && (u.role === 'employee' || u.role === 'admin' || u.role === 'adminplus' || u.role === 'department'));
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
            (student.phone2 && student.phone2.includes(debouncedSearchQuery)) ||
            (student.phone3 && student.phone3.includes(debouncedSearchQuery)) ||
            (student.internalNumber && student.internalNumber.toLowerCase().includes(searchLower));
        
        const matchesPipeline = pipelineFilter.length === 0 || pipelineFilter.some(f => f === 'none' ? !student.pipelineStatus : student.pipelineStatus === f);
        const matchesEmployee = employeeFilter.length === 0 || employeeFilter.some(f => f === 'unassigned' ? !student.employeeId : (student.employeeId && employeeMapByCivilId.get(student.employeeId)?.id === f));

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
        if (countryFilter.length > 0) {
            const appCountries = (student.applications || []).map(a => a.country);
            const matches = countryFilter.some(f => f === 'none' ? appCountries.length === 0 : appCountries.includes(f as any));
            if (!matches) return false;
        }

        const matchesImportType = importTypeFilter === 'all' || student.importMatchType === importTypeFilter;
        const matchesAccepted = acceptedFilter === 'all' || (acceptedFilter === 'accepted' ? !!student.acceptedInfo : !student.acceptedInfo);
        const matchesAcceptedCountry = acceptedCountryFilter.length === 0 || (!!student.acceptedInfo?.country && acceptedCountryFilter.includes(student.acceptedInfo.country.trim()));
        const matchesAcceptedMajor = acceptedMajorFilter.length === 0 || (!!student.acceptedInfo?.major && acceptedMajorFilter.includes(student.acceptedInfo.major.trim()));

        const matchesGender = genderFilter.length === 0 || genderFilter.includes(student.gender ?? '');
        const matchesStudyLevel = studyLevelFilter.length === 0 || studyLevelFilter.includes(student.studyLevel ?? '');
        const matchesSchoolType = schoolTypeFilter.length === 0 || (student.studyLevel === 'Foundation' && schoolTypeFilter.some(f => f === 'none' ? !student.schoolType : student.schoolType === f));

        let matchesChecklist = true;
        if (checklistItemFilter !== 'all' && checklistStatusFilter !== 'all') {
          const [source, itemId] = checklistItemFilter.split(':');
          const statusMap = source === 'admin'
            ? (student.adminChecklistStatus || {})
            : (student.profileCompletionStatus || {});
          const isChecked = !!statusMap[itemId];
          matchesChecklist = checklistStatusFilter === 'checked' ? isChecked : !isChecked;
        }

        return matchesSearch && matchesPipeline && matchesEmployee && matchesIelts && matchesImportType && matchesAccepted && matchesAcceptedCountry && matchesAcceptedMajor && matchesGender && matchesStudyLevel && matchesSchoolType && matchesChecklist;
    });

    return [...filtered].sort((a, b) => {
        // Closed profiles always go last
        if (!!a.isClosed !== !!b.isClosed) return a.isClosed ? 1 : -1;
        if (a.isClosed && b.isClosed) return 0;

        if (!!a.changeAgentRequired !== !!b.changeAgentRequired) return a.changeAgentRequired ? -1 : 1;
        const getNotificationScore = (s: Student) => {
            let score = 0;
            if (s.markedUnreadBy?.includes(currentUser.id)) score += 200;
            if (currentUser.role === 'admin' || currentUser.role === 'adminplus' || currentUser.role === 'department') {
                if ((s.chatUnreadCountByUser?.[currentUser.id] || 0) > 0) score += s.chatUnreadCountByUser![currentUser.id];
                if ((s.newDocumentsForAdmin || 0) > 0 && (!s.newDocsViewedBy || !s.newDocsViewedBy.includes(currentUser.id))) score += s.newDocumentsForAdmin || 0;
                if ((s.newPublicUploadsForAdmin || 0) > 0 && (!s.publicUploadsViewedBy || !s.publicUploadsViewedBy.includes(currentUser.id))) score += (s.newPublicUploadsForAdmin || 0) + 10;
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
  }, [students, debouncedSearchQuery, pipelineFilter, employeeFilter, ieltsFilter, importTypeFilter, acceptedFilter, acceptedCountryFilter, acceptedMajorFilter, genderFilter, studyLevelFilter, schoolTypeFilter, countryFilter, employeeMapByCivilId, currentUser, showAllStudents, effectiveRole, checklistItemFilter, checklistStatusFilter]);

  useEffect(() => {
    if (!isClient || !currentUser?.id) return;
    try {
      sessionStorage.setItem(`applicants_nav_ids_${currentUser.id}`, JSON.stringify(displayedStudents.map(s => s.id)));
    } catch {}
  }, [isClient, currentUser?.id, displayedStudents]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setPipelineFilter([]);
    setEmployeeFilter([]);
    setIeltsFilter('all');
    setGenderFilter([]);
    setStudyLevelFilter([]);
    setSchoolTypeFilter([]);
    setCountryFilter([]);
    setShowAllStudents(false);
    setChecklistItemFilter('all');
    setChecklistStatusFilter('all');
    try {
      sessionStorage.removeItem(`applicants_filters_${currentUser?.id}`);
      sessionStorage.removeItem(`applicants_nav_ids_${currentUser?.id}`);
    } catch {}
  };
  const isFiltered = !!searchQuery || pipelineFilter.length > 0 || employeeFilter.length > 0 || ieltsFilter !== 'all' || importTypeFilter !== 'all' || acceptedFilter !== 'all' || acceptedCountryFilter.length > 0 || acceptedMajorFilter.length > 0 || genderFilter.length > 0 || studyLevelFilter.length > 0 || schoolTypeFilter.length > 0 || countryFilter.length > 0 || showAllStudents || checklistItemFilter !== 'all';

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
    } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
  }

  const isAdminDept = ['admin', 'adminplus', 'department'].includes(currentUser?.role);
  const isAdminOnly = ['admin', 'adminplus'].includes(currentUser?.role);

  return (
    <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-1">
          <div className="flex items-center gap-2.5">
            <h2 className="text-xl font-bold tracking-tight">Applicants List</h2>
            <Badge variant="secondary" className="rounded-full bg-primary/10 text-primary border-primary/20 px-3 py-0.5 font-bold animate-in fade-in zoom-in duration-300">
              {displayedStudents.filter(s => !s.isClosed).length} Students
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

            <div className="flex flex-wrap gap-2 items-center">
                <MultiSelectFilter
                  label="Pipelines"
                  options={[
                    { label: 'No Status', value: 'none' },
                    { label: 'Green', value: 'green' },
                    { label: 'Yellow', value: 'yellow' },
                    { label: 'Orange', value: 'orange' },
                    { label: 'Red', value: 'red' },
                    { label: 'Black', value: 'black' },
                  ]}
                  selected={pipelineFilter}
                  onChange={setPipelineFilter}
                  className="flex-1 min-w-[130px]"
                />
                {isClient && effectiveRole !== 'employee' && (
                  <MultiSelectFilter
                    label="Agents"
                    options={[
                      { label: 'Unassigned', value: 'unassigned' },
                      ...employeeOptions.map(emp => ({ label: `${emp.name}${emp.role !== 'employee' ? ` (${emp.role})` : ''}`, value: emp.id })),
                    ]}
                    selected={employeeFilter}
                    onChange={setEmployeeFilter}
                    className="flex-1 min-w-[130px]"
                  />
                )}
                {isClient && (
                  <MultiSelectFilter
                    label="Countries"
                    options={[
                      { label: 'No Application', value: 'none' },
                      { label: 'UK', value: 'UK' },
                      { label: 'USA', value: 'USA' },
                      { label: 'Australia', value: 'Australia' },
                      { label: 'New Zealand', value: 'New Zealand' },
                    ]}
                    selected={countryFilter}
                    onChange={setCountryFilter}
                    className="flex-1 min-w-[120px]"
                  />
                )}
                {isClient && (
                  <MultiSelectFilter
                    label="Genders"
                    options={[
                      { label: 'Male (M)', value: 'M' },
                      { label: 'Female (F)', value: 'F' },
                    ]}
                    selected={genderFilter}
                    onChange={setGenderFilter}
                    className="flex-1 min-w-[110px]"
                  />
                )}
                {isClient && (
                  <MultiSelectFilter
                    label="Levels"
                    options={[
                      { label: 'Foundation', value: 'Foundation' },
                      { label: 'First Year', value: 'First Year' },
                      { label: 'Transfer Student', value: 'Transfer Student' },
                    ]}
                    selected={studyLevelFilter}
                    onChange={setStudyLevelFilter}
                    className="flex-1 min-w-[110px]"
                  />
                )}
                {isClient && (
                  <MultiSelectFilter
                    label="School"
                    options={[
                      { label: 'Not Set', value: 'none' },
                      { label: 'Private School', value: 'Private' },
                      { label: 'Public School', value: 'Public' },
                    ]}
                    selected={schoolTypeFilter}
                    onChange={setSchoolTypeFilter}
                    className="flex-1 min-w-[110px]"
                  />
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
                <Select value={importTypeFilter} onValueChange={setImportTypeFilter}>
                    <SelectTrigger className="w-full flex-1"><SelectValue placeholder="Import Type" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Profiles</SelectItem>
                        <SelectItem value="new">Imported — New</SelectItem>
                        <SelectItem value="existing">Imported — Existing</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={acceptedFilter} onValueChange={setAcceptedFilter}>
                    <SelectTrigger className="w-full flex-1"><SelectValue placeholder="Acceptance" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All (Accepted or Not)</SelectItem>
                        <SelectItem value="accepted">Accepted</SelectItem>
                        <SelectItem value="not-accepted">Not Accepted</SelectItem>
                    </SelectContent>
                </Select>
                {isClient && acceptedCountryOptions.length > 0 && (
                  <MultiSelectFilter
                    label="Accepted Country"
                    options={acceptedCountryOptions}
                    selected={acceptedCountryFilter}
                    onChange={setAcceptedCountryFilter}
                    className="flex-1 min-w-[130px]"
                  />
                )}
                {isClient && acceptedMajorOptions.length > 0 && (
                  <MultiSelectFilter
                    label="Accepted Major"
                    options={acceptedMajorOptions}
                    selected={acceptedMajorFilter}
                    onChange={setAcceptedMajorFilter}
                    className="flex-1 min-w-[130px]"
                  />
                )}
                {isFiltered && <Button variant="ghost" onClick={handleClearFilters} className="w-full md:w-auto"><X className="mr-2 h-4 w-4" /> Clear Filters</Button>}
            </div>

            {isClient && (readinessChecklistItems.length > 0 || adminChecklistItems.length > 0) && (
              <div className="flex flex-col md:flex-row gap-2 items-center">
                <Select value={checklistItemFilter} onValueChange={v => { setChecklistItemFilter(v); if (v === 'all') setChecklistStatusFilter('all'); }}>
                  <SelectTrigger className="w-full md:w-[260px]">
                    <SelectValue placeholder="Filter by Checklist Item" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Checklist Items</SelectItem>
                    {readinessChecklistItems.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Readiness Checklist</SelectLabel>
                        {readinessChecklistItems.map(item => (
                          <SelectItem key={`readiness:${item.id}`} value={`readiness:${item.id}`}>{item.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {readinessChecklistItems.length > 0 && adminChecklistItems.length > 0 && <SelectSeparator />}
                    {adminChecklistItems.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Admin Checklist</SelectLabel>
                        {adminChecklistItems.map(item => (
                          <SelectItem key={`admin:${item.id}`} value={`admin:${item.id}`}>{item.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>

                {checklistItemFilter !== 'all' && (
                  <Select value={checklistStatusFilter} onValueChange={v => setChecklistStatusFilter(v as any)}>
                    <SelectTrigger className="w-full md:w-[180px]">
                      <SelectValue placeholder="Item Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Any Status</SelectItem>
                      <SelectItem value="checked">✓ Checked</SelectItem>
                      <SelectItem value="unchecked">✗ Not Checked</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            )}
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
                const isAdminDept = ['admin', 'adminplus', 'department'].includes(currentUser.role);
                const requester = student.deletionRequested?.requestedBy ? requesterMap.get(student.deletionRequested.requestedBy) : null;
                const transferRequester = student.transferRequest?.requestedBy ? requesterMap.get(student.transferRequest.requestedBy) : null;
                const canAssign = isAdminDept && !student.employeeId;
                const appCountries = [...new Set(student.applications?.map(app => app.country) || [])];
                const isDuplicate = [student.phone, student.phone2, student.phone3].some(p => p && duplicatePhoneSet.has(p)) || student.duplicatePhoneWarning;
                const isUnassigned = !student.employeeId;

                return (
                <TableRow key={student.id} className={cn(student.changeAgentRequired && "bg-red-50/20", student.isClosed && "opacity-60 bg-gray-100/60", selectedIds.includes(student.id) && "bg-primary/5")}>
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
                      {(student.importListName || student.importMatchType) && (
                        <div className="flex items-center gap-1 flex-wrap mb-1">
                          {student.importListName && (
                            <Badge className="bg-purple-100 text-purple-800 border border-purple-300 text-[10px] font-semibold px-1.5 h-4 w-fit">
                              {student.importListName}
                            </Badge>
                          )}
                          {student.importMatchType && (
                            <Badge className={cn("text-[10px] font-semibold px-1.5 h-4 w-fit border",
                              student.importMatchType === 'new'
                                ? "bg-green-100 text-green-800 border-green-300"
                                : "bg-slate-100 text-slate-700 border-slate-300")}>
                              {student.importMatchType === 'new' ? 'NEW IMPORT' : 'EXISTING'}
                            </Badge>
                          )}
                        </div>
                      )}
                      <Link href={`/student/${student.id}`} className="hover:underline">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {student.internalNumber && <Badge variant="secondary" className="font-bold text-[10px] h-5 px-1 bg-muted">#{student.internalNumber}</Badge>}
                          <span>{student.name || 'Unknown Student'}</span>
                          {student.acceptedInfo && (
                            <span title={`Accepted: ${student.acceptedInfo.country} · ${student.acceptedInfo.major}`} className="inline-flex shrink-0">
                              <CheckCircle2 className="h-4 w-4 text-green-600 stroke-[3]" />
                            </span>
                          )}
                          {student.isClosed && <Badge className="bg-black text-white border-white border uppercase tracking-widest text-[10px] h-5 px-1.5">CLOSED</Badge>}
                          {student.changeAgentRequired && <Badge className="bg-black text-red-500 border-red-500 border animate-pulse uppercase tracking-wider text-[10px] h-5 px-1.5">CHANGE AGENT</Badge>}
                          {isCurrentUserAssigned && student.isNewForEmployee && <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>}
                          {isAdminDept && (student.chatUnreadCountByUser?.[currentUser.id] || 0) > 0 ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.chatUnreadCountByUser![currentUser.id]}</span></Badge> : null}
                          {isAdminDept && student.newDocumentsForAdmin && (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForAdmin}</span></Badge> : null}
                          {isCurrentUserAssigned && student.employeeUnreadMessages && (!student.updatesViewedBy || !student.updatesViewedBy.includes(currentUser.id)) ? <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6"><MessageSquare className="h-3 w-3" /><span>{student.employeeUnreadMessages}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newDocumentsForEmployee && (!student.newDocsViewedBy || !student.newDocsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500"><FilePlus className="h-3 w-3" /><span>{student.newDocumentsForEmployee}</span></Badge> : null}
                          {isAdminDept && (student.newPublicUploadsForAdmin || 0) > 0 && (!student.publicUploadsViewedBy || !student.publicUploadsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-green-500 text-white"><Upload className="h-3 w-3" /><span>{student.newPublicUploadsForAdmin}</span></Badge> : null}
                          {isCurrentUserAssigned && (student.newPublicUploadsForEmployee || 0) > 0 && (!student.publicUploadsViewedBy || !student.publicUploadsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-green-500 text-white"><Upload className="h-3 w-3" /><span>{student.newPublicUploadsForEmployee}</span></Badge> : null}
                          {isCurrentUserAssigned && student.newMissingItemsForEmployee && (!student.missingItemsViewedBy || !student.missingItemsViewedBy.includes(currentUser.id)) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-yellow-500 text-black"><AlertTriangle className="h-3 w-3" /><span>{student.newMissingItemsForEmployee}</span></Badge> : null}
                          {student.markedUnreadBy?.includes(currentUser.id) ? <Badge className="flex items-center gap-1 p-1 h-6 bg-amber-500 text-white"><Bell className="h-3 w-3" /></Badge> : null}
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
                      <div className="text-sm font-bold text-black">{student.phone || 'No Phone'}</div>
                      {student.phone2 && <div className="text-sm text-muted-foreground">{student.phone2}</div>}
                      {student.phone3 && <div className="text-sm text-muted-foreground">{student.phone3}</div>}
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
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'yellow')}>Move to Yellow</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'orange')}>Move to Orange</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'red')}>Move to Red</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'black')}>Move to Black</DropdownMenuItem>
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

