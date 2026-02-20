'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student, User, PipelineStatus } from '@/lib/types';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { StudentTable } from '@/components/dashboard/student-table';
import { Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { PlusCircle } from 'lucide-react';

export default function ApplicantsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const [searchQuery, setSearchQuery] = useState('');
  const [pipelineFilter, setPipelineFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  const [termFilter, setTermFilter] = useState('all');

  const studentsQuery = useMemo(() => {
    if (!firestore || !currentUser) return null;

    if (currentUser.role === 'employee' && currentUser.civilId) {
      return query(
        collection(firestore, 'students'),
        where('employeeId', '==', currentUser.civilId)
      );
    }
    // For admin and department, fetch all students
    return collection(firestore, 'students');
  }, [firestore, currentUser]);

  const { data: students, isLoading: studentsAreLoading } = useCollection<Student>(studentsQuery);
  
  const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);
  
  const academicTerms = useMemo(() => {
    if (!students) return [];
    const terms = students.map(s => s.term).filter(Boolean);
    return [...new Set(terms)];
  }, [students]);

  const filteredStudents = useMemo(() => {
    if (!students) return [];

    return students.filter(student => {
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch =
        student.name.toLowerCase().includes(searchLower) ||
        student.email.toLowerCase().includes(searchLower) ||
        student.phone.toLowerCase().includes(searchLower);
      
      const matchesPipeline =
        pipelineFilter === 'all' || student.pipelineStatus === pipelineFilter;

      const studentEmployeeId = student.employeeId || 'unassigned';
      const matchesEmployee =
        employeeFilter === 'all' || studentEmployeeId === employeeFilter;
      
      const matchesTerm =
        termFilter === 'all' || student.term === termFilter;

      return matchesSearch && matchesPipeline && matchesEmployee && matchesTerm;
    });
  }, [students, searchQuery, pipelineFilter, employeeFilter, termFilter]);
  
  const isLoading = isUserLoading || usersLoading || studentsAreLoading;
  
  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  if (!currentUser) {
    // This case should be handled by the layout, but as a fallback:
    return <p>You must be logged in to view this page.</p>
  }
  
  const canCreateStudentForSelf = currentUser.role === 'employee' && !!currentUser.civilId;
  const canCreateUnassigned = currentUser.role === 'admin' || currentUser.role === 'department';


  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>Applicants</CardTitle>
            <CardDescription>
              {currentUser.role === 'employee' ? 'Your assigned students.' : 'All students in the system.'}
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {(canCreateStudentForSelf || canCreateUnassigned) && (
              <Button asChild>
                <Link href={canCreateStudentForSelf ? '/new-request' : '/new-request?unassigned=true'}>
                  <PlusCircle />
                  Add Student
                </Link>
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 mb-4 md:flex-row">
            <div className="relative w-full flex-1">
              <Search className="absolute left-2.5 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or phone..."
                className="pl-8 w-full"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <Select value={pipelineFilter} onValueChange={setPipelineFilter}>
                <SelectTrigger className="w-full sm:w-auto md:w-[150px]">
                  <SelectValue placeholder="Pipeline Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Pipelines</SelectItem>
                  <SelectItem value="green">Green</SelectItem>
                  <SelectItem value="orange">Orange</SelectItem>
                  <SelectItem value="red">Red</SelectItem>
                  <SelectItem value="none">No Status</SelectItem>
                </SelectContent>
              </Select>
              
              {(currentUser.role === 'admin' || currentUser.role === 'department') && (
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger className="w-full sm:w-auto md:w-[180px]">
                        <SelectValue placeholder="Filter by employee" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {employees.map(emp => (<SelectItem key={emp.id} value={emp.civilId || ''}>{emp.name}</SelectItem>))}
                    </SelectContent>
                </Select>
              )}

              <Select value={termFilter} onValueChange={setTermFilter}>
                <SelectTrigger className="w-full sm:w-auto md:w-[180px]">
                  <SelectValue placeholder="Filter by term" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Terms</SelectItem>
                  {academicTerms.map(term => (<SelectItem key={term} value={term}>{term}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <StudentTable 
            students={filteredStudents} 
            users={users} 
            currentUser={currentUser}
            showEmployee={currentUser.role !== 'employee'}
            showPipelineStatus
            showIelts
            showTerm
            showCountries
            showApplicationCount
          />

        </CardContent>
      </Card>
    </div>
  );
}
