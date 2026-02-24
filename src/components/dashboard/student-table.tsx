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
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoreHorizontal, GraduationCap, ArrowRightLeft, Repeat, MessageSquare, FilePlus, AlertTriangle, Search, X } from 'lucide-react';
import type { Student, PipelineStatus, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { updateStudentPipelineStatus } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';


interface StudentTableProps {
  students: Student[];
  currentUser: AppUser;
  allUsers: User[];
  showEmployee?: boolean;
  showPipelineStatus?: boolean;
  showIelts?: boolean;
  showTerm?: boolean;
  showCountries?: boolean;
  emptyStateMessage?: string;
  showApplicationCount?: boolean;
  showAssignedFilter?: boolean;
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


export function StudentTable({ students, currentUser, allUsers, showEmployee = false, showPipelineStatus = false, showIelts = false, showTerm = false, showCountries = false, emptyStateMessage = "No students found.", showApplicationCount = false, showAssignedFilter = false }: StudentTableProps) {
  const { toast } = useToast();
  
  // State for employee tabs
  const [assignedFilter, setAssignedFilter] = useState<'all' | 'mine'>(
    currentUser.role === 'employee' ? 'mine' : 'all'
  );

  // State for all filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStatus | 'all'>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [ieltsFilter, setIeltsFilter] = useState('all');
  const [termFilter, setTermFilter] = useState('all');

  useEffect(() => {
    const handler = setTimeout(() => {
        setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Prepare data for dropdowns
  const employeeOptions = useMemo(() => allUsers.filter(u => u.role === 'employee'), [allUsers]);
  const termOptions = useMemo(() => {
    const terms = students.map(s => s.term).filter(Boolean);
    return [...new Set(terms)] as string[];
  }, [students]);

  const employeeMapByCivilId = useMemo(() => {
    const map = new Map<string, User>();
    allUsers.forEach(u => {
      if(u.civilId) map.set(u.civilId, u);
    });
    return map;
  }, [allUsers]);

  const displayedStudents = useMemo(() => {
    let tempStudents = [...students];

    // Employee 'My Assigned' tab filter
    if (showAssignedFilter && assignedFilter === 'mine' && currentUser.civilId) {
      tempStudents = tempStudents.filter(s => s.employeeId === currentUser.civilId);
    }

    // Dropdown/Search Filters
    return tempStudents.filter(student => {
        const searchLower = debouncedSearchQuery.toLowerCase();
        const matchesSearch = !debouncedSearchQuery || 
            student.name.toLowerCase().includes(searchLower) ||
            (student.email && student.email.toLowerCase().includes(searchLower)) ||
            (student.phone && student.phone.includes(debouncedSearchQuery));
        
        const matchesPipeline = pipelineFilter === 'all' || student.pipelineStatus === pipelineFilter || (pipelineFilter === 'none' && !student.pipelineStatus);
        
        const matchesEmployee = employeeFilter === 'all' || 
            (employeeFilter === 'unassigned' && !student.employeeId) || 
            (student.employeeId && employeeMapByCivilId.get(student.employeeId)?.id === employeeFilter);

        const minIelts = ieltsFilter === 'all' ? 0 : parseFloat(ieltsFilter);
        const matchesIelts = ieltsFilter === 'all' || (student.ielts?.overall || 0) >= minIelts;
        
        const matchesTerm = termFilter === 'all' || student.term === termFilter;

        const isVisibleForRole = currentUser.role === 'employee' ? true : matchesEmployee;

        return matchesSearch && matchesPipeline && isVisibleForRole && matchesIelts && matchesTerm;
    });
  }, [
    students, showAssignedFilter, assignedFilter, currentUser.civilId, debouncedSearchQuery,
    pipelineFilter, employeeFilter, ieltsFilter, termFilter, employeeMapByCivilId, currentUser.role
  ]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setPipelineFilter('all');
    setEmployeeFilter('all');
    setIeltsFilter('all');
    setTermFilter('all');
  };
  const isFiltered = searchQuery || pipelineFilter !== 'all' || employeeFilter !== 'all' || ieltsFilter !== 'all' || termFilter !== 'all';


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
    } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
  }

  const numColumns = [showEmployee, showPipelineStatus, showIelts, showApplicationCount, showTerm, showCountries].filter(Boolean).length + 2;

  const currentEmptyStateMessage = displayedStudents.length === 0 && isFiltered 
      ? 'No students match your current filters.' 
      : (assignedFilter === 'mine' ? 'You have no assigned students.' : emptyStateMessage);

  return (
    <div>
      <div className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
                placeholder="Search name, email, or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-full"
            />
        </div>
        {showPipelineStatus && (
            <Select value={pipelineFilter} onValueChange={(v) => setPipelineFilter(v as any)}>
                <SelectTrigger className="w-full md:w-[150px]">
                    <SelectValue placeholder="Pipeline Status" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Pipelines</SelectItem>
                    <SelectItem value="none">No Status</SelectItem>
                    <SelectItem value="green">Green</SelectItem>
                    <SelectItem value="orange">Orange</SelectItem>
                    <SelectItem value="red">Red</SelectItem>
                </SelectContent>
            </Select>
        )}
        {showEmployee && (
             <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="Assigned Employee" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {employeeOptions.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )}
         {showIelts && (
             <Select value={ieltsFilter} onValueChange={setIeltsFilter}>
                <SelectTrigger className="w-full md:w-[120px]">
                    <SelectValue placeholder="Min IELTS" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">Any IELTS</SelectItem>
                    <SelectItem value="5.0">5.0+</SelectItem>
                    <SelectItem value="5.5">5.5+</SelectItem>
                    <SelectItem value="6.0">6.0+</SelectItem>
                    <SelectItem value="6.5">6.5+</SelectItem>
                    <SelectItem value="7.0">7.0+</SelectItem>
                </SelectContent>
            </Select>
        )}
        {showTerm && termOptions.length > 0 && (
             <Select value={termFilter} onValueChange={setTermFilter}>
                <SelectTrigger className="w-full md:w-[150px]">
                    <SelectValue placeholder="Term" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="all">All Terms</SelectItem>
                    {termOptions.map(term => (
                        <SelectItem key={term} value={term}>{term}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
        )}
        {isFiltered && <Button variant="ghost" onClick={handleClearFilters}><X className="mr-2 h-4 w-4" /> Clear</Button>}
      </div>

      {showAssignedFilter && (
        <Tabs value={assignedFilter} onValueChange={(value) => setAssignedFilter(value as 'all' | 'mine')} className="mb-4">
          <TabsList>
            <TabsTrigger value="mine">My Assigned</TabsTrigger>
            <TabsTrigger value="all">All Applicants</TabsTrigger>
          </TabsList>
        </Tabs>
      )}
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Student</TableHead>
              {showApplicationCount && <TableHead>Application Tracking</TableHead>}
              {showPipelineStatus && <TableHead>Pipeline</TableHead>}
              {showCountries && <TableHead>Countries</TableHead>}
              {showEmployee && <TableHead>Assigned Employee</TableHead>}
              {showIelts && <TableHead>IELTS Overall</TableHead>}
              {showTerm && <TableHead>Term</TableHead>}
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedStudents.length > 0 ? (
              displayedStudents.map((student) => {
                const wasTransferred = student.transferHistory?.some(t => t.fromEmployeeId);
                const applicationCountries = Array.from(new Set(student.applications.map(app => app.country))).join(', ');
                const isCurrentUserAssigned = currentUser.civilId === student.employeeId;
                const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);

                return (
                <TableRow key={student.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar>
                        <AvatarImage src={student.avatarUrl} alt={student.name} />
                        <AvatarFallback>{student?.name?.charAt(0) ?? 'S'}</AvatarFallback>
                      </Avatar>
                      <div>
                        <Link href={`/student/${student.id}`} className="hover:underline">
                          <div className="font-medium flex items-center gap-2 flex-wrap">
                            <span>{student.name || 'Unknown Student'}</span>
                            {isCurrentUserAssigned && student.isNewForEmployee && (
                                <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>
                            )}
                            {isAdminOrDept && student.unreadUpdates && student.unreadUpdates > 0 && (
                              <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6">
                                <MessageSquare className="h-3 w-3" />
                                <span>{student.unreadUpdates}</span>
                              </Badge>
                            )}
                            {isAdminOrDept && (student.newDocumentsForAdmin || 0) > 0 && (
                              <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500 hover:bg-blue-600">
                                <FilePlus className="h-3 w-3" />
                                <span>{student.newDocumentsForAdmin}</span>
                              </Badge>
                            )}
                            {isCurrentUserAssigned && (student.employeeUnreadMessages || 0) > 0 && (
                              <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6">
                                  <MessageSquare className="h-3 w-3" />
                                  <span>{student.employeeUnreadMessages}</span>
                              </Badge>
                            )}
                            {isCurrentUserAssigned && (student.newDocumentsForEmployee || 0) > 0 && (
                                <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500 hover:bg-blue-600">
                                    <FilePlus className="h-3 w-3" />
                                    <span>{student.newDocumentsForEmployee}</span>
                                </Badge>
                            )}
                            {isCurrentUserAssigned && (student.newMissingItemsForEmployee || 0) > 0 && (
                                <Badge className="flex items-center gap-1 p-1 h-6 bg-yellow-500 hover:bg-yellow-500 text-black">
                                    <AlertTriangle className="h-3 w-3" />
                                    <span>{student.newMissingItemsForEmployee}</span>
                                </Badge>
                            )}
                            {student.transferRequested && (
                                <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                                    <ArrowRightLeft className="mr-1 h-3 w-3" />
                                    Transfer Requested
                                </Badge>
                            )}
                            {wasTransferred && (
                                <Badge variant="outline" className="border-blue-500 text-blue-600">
                                    <Repeat className="mr-1 h-3 w-3" />
                                    Transferred
                                </Badge>
                            )}
                          </div>
                        </Link>
                        <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                        <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                        {student.finalChoiceUniversity && (
                          <div className="flex items-center gap-1 text-lg text-success font-bold mt-1">
                            <GraduationCap className="h-5 w-5" />
                            <span>{student.finalChoiceUniversity}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  {showApplicationCount && (
                    <TableCell>
                      <div className="text-center font-medium">{student.applications.length}</div>
                    </TableCell>
                  )}
                  {showPipelineStatus && (
                    <TableCell>
                      <Badge variant="default" className={cn("capitalize", pipelineStatusStyles[student.pipelineStatus || 'none'])}>
                        {pipelineStatusLabels[student.pipelineStatus || 'none']}
                      </Badge>
                    </TableCell>
                  )}
                  {showCountries && (
                    <TableCell>
                      {applicationCountries ? (
                        <span>{applicationCountries}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                  )}
                  {showEmployee && (
                    <TableCell>{getEmployeeName(student.employeeId)}</TableCell>
                  )}
                  {showIelts && (
                    <TableCell>
                      {student.ielts?.overall ? (
                          <Badge variant="secondary">{student.ielts.overall.toFixed(1)}</Badge>
                      ) : (
                          <Badge variant="outline">0</Badge>
                      )}
                    </TableCell>
                  )}
                  {showTerm && (
                    <TableCell>
                      {student.term ? (
                          <Badge variant="outline">{student.term}</Badge>
                      ) : (
                          <span className="text-sm text-muted-foreground">N/A</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                    <Link href={`/student/${student.id}`}>View Details</Link>
                                </DropdownMenuItem>
                                {currentUser?.role === 'employee' && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'green')}>
                                            <span>Move to Green</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'orange')}>
                                            <span>Move to Orange</span>
                                        </DropdownMenuItem>
                                        <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'red')}>
                                            <span>Move to Red</span>
                                        </DropdownMenuItem>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              )})
            ) : (
              <TableRow>
                  <TableCell colSpan={numColumns} className="h-24 text-center">
                      {currentEmptyStateMessage}
                  </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
