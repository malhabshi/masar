
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import type { Student, Country, User } from '@/lib/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Loader2 } from 'lucide-react';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, getDocs, doc, getDoc, documentId } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

// --- Data fetching and view for Admins/Departments ---
function AdminFinalizedView({ user, users }: { user: User; users: User[] }) {
  const { firestore } = useFirebase();

  const studentsQuery = useMemoFirebase(() => {
    if (!firestore) return null;
    return query(collection(firestore, 'students'), where('finalChoiceUniversity', '!=', null));
  }, [firestore]);
  const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsQuery);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [schoolFilter, setSchoolFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [employeeFilter, setEmployeeFilter] = useState('all');
  
  const finalizedStudents = useMemo(() => (studentsData || []) as FinalizedStudent[], [studentsData]);

  const { schools, countries, employees } = useMemo(() => {
    const schoolSet = new Set<string>();
    const countrySet = new Set<Country>();
    
    finalizedStudents.forEach(student => {
      schoolSet.add(student.finalChoiceUniversity);
      const app = student.applications.find(a => a.university === student.finalChoiceUniversity);
      if (app) countrySet.add(app.country);
    });
    
    return {
      schools: Array.from(schoolSet).sort(),
      countries: Array.from(countrySet).sort(),
      employees: users.filter(u => u.role === 'employee'),
    };
  }, [finalizedStudents, users]);

  const filteredStudents = useMemo(() => {
    return finalizedStudents.filter(student => {
      const searchLower = searchQuery.toLowerCase();
      const studentApp = student.applications.find(a => a.university === student.finalChoiceUniversity);
      const employee = student.employeeId ? users.find(u => u.civilId === student.employeeId) : null;

      const matchesSearch =
        student.name.toLowerCase().includes(searchLower) ||
        (student.email && student.email.toLowerCase().includes(searchLower)) ||
        (employee && employee.name.toLowerCase().includes(searchLower)) ||
        student.finalChoiceUniversity.toLowerCase().includes(searchLower);

      const matchesSchool = schoolFilter === 'all' || student.finalChoiceUniversity === schoolFilter;
      const matchesCountry = countryFilter === 'all' || (studentApp && studentApp.country === countryFilter);
      const matchesEmployee = employeeFilter === 'all' || student.employeeId === employeeFilter;

      return matchesSearch && matchesSchool && matchesCountry && matchesEmployee;
    });
  }, [searchQuery, schoolFilter, countryFilter, employeeFilter, finalizedStudents, users]);

  return (
      <Card>
      <CardHeader>
        <CardTitle>Finalized Students</CardTitle>
        <CardDescription>A list of all students who have made their final university choice.</CardDescription>
      </CardHeader>
      <CardContent>
        {studentsLoading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
        <>
            <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-4">
            <div className="relative w-full md:max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input type="search" placeholder="Search by student, employee, school..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <Select value={schoolFilter} onValueChange={setSchoolFilter}><SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by school" /></SelectTrigger><SelectContent><SelectItem value="all">All Schools</SelectItem>{schools.map(school => (<SelectItem key={school} value={school}>{school}</SelectItem>))}</SelectContent></Select>
                <Select value={countryFilter} onValueChange={setCountryFilter}><SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by country" /></SelectTrigger><SelectContent><SelectItem value="all">All Countries</SelectItem>{countries.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent></Select>
                <Select value={employeeFilter} onValueChange={setEmployeeFilter}><SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by employee" /></SelectTrigger><SelectContent><SelectItem value="all">All Employees</SelectItem>{employees.map(emp => (<SelectItem key={emp.id} value={emp.civilId || emp.id}>{emp.name}</SelectItem>))}</SelectContent></Select>
            </div>
            </div>
            <FinalizedStudentsTable students={filteredStudents} users={users} showEmployee={true} />
        </>
        )}
      </CardContent>
    </Card>
  )
}


// --- Data fetching and view for Employees ---
function EmployeeFinalizedView({ user, users }: { user: User; users: User[] }) {
    const { firestore } = useFirebase();

    // Fetch ALL finalized students for the current employee
    const employeeStudentsQuery = useMemoFirebase(() => {
        if (!firestore || !user.civilId) return null;
        return query(
            collection(firestore, 'students'), 
            where('employeeId', '==', user.civilId)
        );
    }, [firestore, user.civilId]);

    const { data: employeeStudents, isLoading: studentsLoading } = useCollection<Student>(employeeStudentsQuery);
  
    const [searchQuery, setSearchQuery] = useState('');
    const [schoolFilter, setSchoolFilter] = useState('all');
    const [countryFilter, setCountryFilter] = useState('all');

    // Client-side filter for finalized students
    const finalizedStudents = useMemo(() => {
        if (!employeeStudents) return [];
        return employeeStudents.filter(s => s.finalChoiceUniversity) as FinalizedStudent[];
    }, [employeeStudents]);

    const { schools, countries } = useMemo(() => {
        const schoolSet = new Set<string>();
        const countrySet = new Set<Country>();
        finalizedStudents.forEach(student => {
            schoolSet.add(student.finalChoiceUniversity);
            const app = student.applications.find(a => a.university === student.finalChoiceUniversity);
            if (app) countrySet.add(app.country);
        });
        return {
            schools: Array.from(schoolSet).sort(),
            countries: Array.from(countrySet).sort(),
        };
    }, [finalizedStudents]);

    const filteredStudents = useMemo(() => {
        return finalizedStudents.filter(student => {
            const searchLower = searchQuery.toLowerCase();
            const studentApp = student.applications.find(a => a.university === student.finalChoiceUniversity);

            const matchesSearch =
                student.name.toLowerCase().includes(searchLower) ||
                (student.email && student.email.toLowerCase().includes(searchLower)) ||
                student.finalChoiceUniversity.toLowerCase().includes(searchLower);

            const matchesSchool = schoolFilter === 'all' || student.finalChoiceUniversity === schoolFilter;
            const matchesCountry = countryFilter === 'all' || (studentApp && studentApp.country === countryFilter);

            return matchesSearch && matchesSchool && matchesCountry;
        });
    }, [searchQuery, schoolFilter, countryFilter, finalizedStudents]);
    
    return (
        <Card>
            <CardHeader>
                <CardTitle>My Finalized Students</CardTitle>
                <CardDescription>A list of your assigned students who have made their final university choice.</CardDescription>
            </CardHeader>
            <CardContent>
                {studentsLoading ? (
                     <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
                ): (
                <>
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-4">
                        <div className="relative w-full md:max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="search" placeholder="Search by student, school..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                        <div className="flex gap-2 w-full md:w-auto">
                            <Select value={schoolFilter} onValueChange={setSchoolFilter}><SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by school" /></SelectTrigger><SelectContent><SelectItem value="all">All Schools</SelectItem>{schools.map(school => (<SelectItem key={school} value={school}>{school}</SelectItem>))}</SelectContent></Select>
                            <Select value={countryFilter} onValueChange={setCountryFilter}><SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Filter by country" /></SelectTrigger><SelectContent><SelectItem value="all">All Countries</SelectItem>{countries.map(c => (<SelectItem key={c} value={c}>{c}</SelectItem>))}</SelectContent></Select>
                        </div>
                    </div>
                    <FinalizedStudentsTable students={filteredStudents} users={users} showEmployee={false} />
                </>
                )}
            </CardContent>
        </Card>
    );
}

// --- Main Page Component ---
export default function FinalizedStudentsPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  
  const isLoading = isUserLoading || usersLoading;

  if (isLoading) {
    return (
        <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin" />
        </div>
    );
  }

  if (!user) {
      return (
          <div className="flex items-center justify-center h-full">
              <p className="text-muted-foreground">Please log in to view this page.</p>
          </div>
      );
  }

  if (['admin', 'department'].includes(user.role)) {
    return <AdminFinalizedView user={user} users={users} />;
  }

  return <EmployeeFinalizedView user={user} users={users} />;
}
