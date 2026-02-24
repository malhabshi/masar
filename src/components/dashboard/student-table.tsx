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
  
  // State for tabs (only for employees)
  const [assignedFilter, setAssignedFilter] = useState<'all' | 'mine'>(
    currentUser.role === 'employee' ? 'mine' : 'all'
  );

  // State for all filters
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState<PipelineStatus | 'all'>('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [ieltsFilter, setIeltsFilter] = useState('all');
  const [termFilter, setTermFilter] = useState('');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);


  useEffect(() => {
    const handler = setTimeout(() => {
        setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Prepare data for dropdowns
  const employeeOptions = useMemo(() => allUsers.filter(u => u.role === 'employee'), [allUsers]);
  
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
    if (currentUser.role === 'employee' && assignedFilter === 'mine' && currentUser.civilId) {
      tempStudents = tempStudents.filter(s => s.employeeId === currentUser.civilId);
    }

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

        const studentIelts = student.ielts?.overall ?? 0;
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
        
        const matchesTerm = !termFilter.trim() || (student.term && student.term.toLowerCase().includes(termFilter.trim().toLowerCase()));

        return matchesSearch && matchesPipeline && matchesEmployee && matchesIelts && matchesTerm;
    });
  }, [
    students, assignedFilter, currentUser.civilId, currentUser.role, debouncedSearchQuery,
    pipelineFilter, employeeFilter, ieltsFilter, termFilter, employeeMapByCivilId
  ]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setPipelineFilter('all');
    setEmployeeFilter('all');
    setIeltsFilter('all');
    setTermFilter('');
  };
  const isFiltered = searchQuery || pipelineFilter !== 'all' || employeeFilter !== 'all' || ieltsFilter !== 'all' || termFilter;

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

  const numColumns = 6;

  const currentEmptyStateMessage = displayedStudents.length === 0 && isFiltered 
      ? 'No students match your current filters.' 
      : (assignedFilter === 'mine' ? 'You have no assigned students.' : emptyStateMessage);

  return (
    <div>
        <div className="flex flex-col gap-4 mb-4">
            <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name, email, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 w-full"
                />
            </div>
            <div className="flex flex-col md:flex-row gap-2 items-center">
                <Select value={pipelineFilter} onValueChange={(v) => setPipelineFilter(v as any)}>
                    <SelectTrigger className="w-full flex-1">
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
                {currentUser.role !== 'employee' && (
                    <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                        <SelectTrigger className="w-full flex-1">
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
                <Select value={ieltsFilter} onValueChange={setIeltsFilter}>
                    <SelectTrigger className="w-full flex-1">
                        <SelectValue placeholder="IELTS Score" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Scores</SelectItem>
                        <SelectItem value="0">0</SelectItem>
                        <SelectItem value="<=5.0">5.0 or less</SelectItem>
                        <SelectItem value="5.5">5.5</SelectItem>
                        <SelectItem value="6.0">6.0</SelectItem>
                        <SelectItem value=">=6.5">6.5+</SelectItem>
                    </SelectContent>
                </Select>
                <Input
                    placeholder="Filter by term..."
                    value={termFilter}
                    onChange={(e) => setTermFilter(e.target.value)}
                    className="w-full flex-1"
                />
                {isFiltered && <Button variant="ghost" onClick={handleClearFilters} className="w-full md:w-auto"><X className="mr-2 h-4 w-4" /> Clear Filters</Button>}
            </div>
        </div>

      {isClient && currentUser.role === 'employee' && (
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
              <TableHead>Pipeline</TableHead>
              <TableHead>Assigned Employee</TableHead>
              <TableHead>IELTS Overall</TableHead>
              <TableHead>Term</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedStudents.length > 0 ? (
              displayedStudents.map((student) => {
                const wasTransferred = student.transferHistory?.some(t => t.fromEmployeeId);
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
                  <TableCell>
                    <Badge variant="default" className={cn("capitalize", pipelineStatusStyles[student.pipelineStatus || 'none'])}>
                      {pipelineStatusLabels[student.pipelineStatus || 'none']}
                    </Badge>
                  </TableCell>
                  <TableCell>{getEmployeeName(student.employeeId)}</TableCell>
                  <TableCell>
                    {student.ielts?.overall ? (
                        <Badge variant="secondary">{student.ielts.overall.toFixed(1)}</Badge>
                    ) : (
                        <Badge variant="outline">0</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {student.term ? (
                        <Badge variant="outline">{student.term}</Badge>
                    ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
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
