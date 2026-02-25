'use client';

import { useMemo, useState, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student, User, Country } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Loader2, AlertTriangle } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

export default function FinalizedStudentsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  // Filters for admin/dept
  const [universityFilter, setUniversityFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const studentsQuery = useMemo(() => {
    if (!isMounted || !currentUser) {
      return null;
    }
    
    if (currentUser.role === 'admin' || currentUser.role === 'department') {
      return [where('finalChoiceUniversity', '>', '')];
    }
    
    if (currentUser.role === 'employee') {
      if (!currentUser.civilId) {
        return null;
      }
      // For employees, we fetch all their students and filter for finalized on the client
      // to avoid composite query security rule issues.
      return [where('employeeId', '==', currentUser.civilId)];
    }
    
    return null;
  }, [isMounted, currentUser]);

  const { data: fetchedStudents, isLoading: studentsAreLoading, error: studentsError } = useCollection<Student>(
    studentsQuery ? 'students' : '',
    ...(studentsQuery || [])
  );
  
  const { data: allUsers, isLoading: usersLoading } = useCollection<User>(
    (currentUser?.role === 'admin' || currentUser?.role === 'department') ? 'users' : ''
  );

  const employeeOptions = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter(u => u.role === 'employee' && u.civilId);
  }, [allUsers]);

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

  const finalizedStudents = useMemo(() => {
    if (!fetchedStudents) return [];

    let studentsToFilter = fetchedStudents;

    // For employees, client-side filter for finalized status from their list of all students.
    if (currentUser?.role === 'employee') {
      return studentsToFilter.filter(s => s.finalChoiceUniversity && s.finalChoiceUniversity.length > 0);
    }
    
    // For admins/depts, apply the UI filters.
    if (currentUser?.role === 'admin' || currentUser?.role === 'department') {
        return studentsToFilter.filter(student => {
            const matchesUniversity = !universityFilter || (student.finalChoiceUniversity && student.finalChoiceUniversity.toLowerCase().includes(universityFilter.toLowerCase()));

            const application = student.applications.find(app => app.university === student.finalChoiceUniversity);
            const studentCountry = application?.country;
            const matchesCountry = countryFilter === 'all' || studentCountry === countryFilter;
            
            const matchesEmployee = employeeFilter === 'all' || student.employeeId === employeeFilter;

            return matchesUniversity && matchesCountry && matchesEmployee;
        });
    }
    
    return studentsToFilter;
  }, [fetchedStudents, currentUser?.role, universityFilter, countryFilter, employeeFilter]);


  const isLoading = isUserLoading || !isMounted || (studentsQuery && studentsAreLoading) || usersLoading;

  const pageDescription = currentUser?.role === 'employee' 
    ? "A list of your students who have made their final university choice."
    : "All students who have made their final university choice.";

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }
  
  if (!currentUser) {
       return (
        <Card>
            <CardHeader>
                <CardTitle>Access Denied</CardTitle>
                <CardDescription>You must be logged in to view this page.</CardDescription>
            </CardHeader>
        </Card>
       )
  }

  if (currentUser.role === 'employee' && !currentUser.civilId) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Profile Incomplete</CardTitle>
                <CardDescription>Your user profile is missing a Civil ID. Please contact an administrator.</CardDescription>
            </CardHeader>
        </Card>
    )
  }

  if (studentsError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Permission Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Could not load finalized students. This is likely a Firestore security rule issue. Please contact support.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Finalized Students</CardTitle>
        <CardDescription>
          {pageDescription}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {(currentUser.role === 'admin' || currentUser.role === 'department') && (
            <div className="flex flex-col md:flex-row gap-2 mb-4">
                <Input
                    placeholder="Filter by university..."
                    value={universityFilter}
                    onChange={(e) => setUniversityFilter(e.target.value)}
                    className="w-full"
                />
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder="Filter by country" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Countries</SelectItem>
                        {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                    <SelectTrigger className="w-full">
                        <SelectValue placeholder="Filter by employee" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Employees</SelectItem>
                        {employeeOptions.map(emp => (
                            <SelectItem key={emp.id} value={emp.civilId!}>{emp.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        )}
        <FinalizedStudentsTable
          students={(finalizedStudents as FinalizedStudent[]) || []}
          showEmployee={currentUser.role !== 'employee'}
        />
      </CardContent>
    </Card>
  );
}
