'use client';

import { useUser } from '@/hooks/use-user';
import { StudentTable } from '@/components/dashboard/student-table';
import { Button } from '@/components/ui/button';
import { PlusCircle, Search, Loader2 } from 'lucide-react';
import type { Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMemo, useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ImportStudentsDialog } from '@/components/dashboard/import-students-dialog';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where, getDocs, doc, getDoc, documentId } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';

// This component fetches and displays student data for Admins/Departments
function AdminStudentView({ user, users }: { user: User, users: User[] }) {
    const { firestore } = useFirebase();

    const [searchQuery, setSearchQuery] = useState('');
    const [pipelineFilter, setPipelineFilter] = useState('all');
    const [employeeFilter, setEmployeeFilter] = useState('all');
    const [ieltsFilter, setIeltsFilter] = useState('all');
    const [termFilter, setTermFilter] = useState('all');
    
    const termsCollection = useMemoFirebase(() => firestore ? collection(firestore, 'academic_terms') : null, [firestore]);
    const { data: termsData } = useCollection(termsCollection);
    const terms = useMemo(() => termsData?.map(t => t.name) || [], [termsData]);
    const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

    const studentsQuery = useMemoFirebase(() => {
        if (!firestore) return null;
        return collection(firestore, 'students');
    }, [firestore]);

    const { data: studentsData, isLoading: studentsLoading } = useCollection<Student>(studentsQuery);

    // Client-side filtering for all filter controls
    const filteredStudents = useMemo(() => {
        if (!studentsData) return [];

        return studentsData.filter(student => {
            // Corrected Pipeline filter
            const studentPipelineStatus = student.pipelineStatus || 'none';
            const matchesPipeline = pipelineFilter === 'all' || studentPipelineStatus === pipelineFilter;

            // Corrected Employee filter
            const studentEmployeeId = student.employeeId || 'unassigned';
            const matchesEmployee = employeeFilter === 'all' || studentEmployeeId === employeeFilter;
            
            // Text search
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = !searchQuery ||
                                (student.name || '').toLowerCase().includes(searchLower) ||
                                (student.email || '').toLowerCase().includes(searchLower) ||
                                (student.phone || '').toLowerCase().includes(searchLower);

            // Term filter
            const matchesTerm = termFilter === 'all' || student.term === termFilter;

            // Corrected IELTS filter
            const matchesIelts = (() => {
                const overallScore = student.ielts?.overall;
                if (ieltsFilter === 'all') return true;
                if (ieltsFilter === 'not-set') return overallScore === undefined || overallScore === null;
                if (ieltsFilter === '<4.5') return overallScore !== undefined && overallScore !== null && overallScore < 4.5;
                if (ieltsFilter === '6.5+') return overallScore !== undefined && overallScore !== null && overallScore >= 6.5;
                const ieltsScore = parseFloat(ieltsFilter);
                if (!isNaN(ieltsScore)) return overallScore !== undefined && overallScore !== null && overallScore === ieltsScore;
                return true; 
            })();
            
            return matchesPipeline && matchesEmployee && matchesSearch && matchesIelts && matchesTerm;
        }).sort((a, b) => {
            const hasAdminNotification = (s: Student) => (s.unreadUpdates || 0) > 0 || (s.newDocumentsForAdmin || 0) > 0 || s.transferRequested || s.deletionRequested;
            const hasNotificationA = hasAdminNotification(a);
            const hasNotificationB = hasAdminNotification(b);
            if (hasNotificationA && !hasNotificationB) return -1;
            if (!hasNotificationA && hasNotificationB) return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [searchQuery, pipelineFilter, employeeFilter, ieltsFilter, termFilter, studentsData]);

    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold">All Applicants</h2>
            <div className="flex items-center gap-2">
                <ImportStudentsDialog currentUser={user} />
                <Button asChild>
                  <a href="/new-request">
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add a New Student
                  </a>
                </Button>
            </div>
        </div>
        <Card>
            <CardHeader>
                <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                    <div className="relative w-full md:max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input type="search" placeholder="Search by name, email, or phone..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                    </div>
                    <div className="flex gap-2 w-full flex-wrap md:w-auto justify-end">
                        <Select value={pipelineFilter} onValueChange={setPipelineFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by pipeline" /></SelectTrigger><SelectContent><SelectItem value="all">All Pipelines</SelectItem><SelectItem value="green">Green</SelectItem><SelectItem value="orange">Orange</SelectItem><SelectItem value="red">Red</SelectItem><SelectItem value="none">No Status</SelectItem></SelectContent></Select>
                        <Select value={employeeFilter} onValueChange={setEmployeeFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by employee" /></SelectTrigger><SelectContent><SelectItem value="all">All Employees</SelectItem><SelectItem value="unassigned">Unassigned</SelectItem>{employees.map(emp => (<SelectItem key={emp.id} value={emp.civilId || ''}>{emp.name}</SelectItem>))}</SelectContent></Select>
                        <Select value={ieltsFilter} onValueChange={setIeltsFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by IELTS" /></SelectTrigger><SelectContent><SelectItem value="all">All IELTS Scores</SelectItem><SelectItem value="not-set">Not Set</SelectItem><SelectItem value="<4.5">Below 4.5</SelectItem><SelectItem value="5.0">5.0</SelectItem><SelectItem value="5.5">5.5</SelectItem><SelectItem value="6.0">6.0</SelectItem><SelectItem value="6.5+">6.5+</SelectItem></SelectContent></Select>
                        <Select value={termFilter} onValueChange={setTermFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by Term" /></SelectTrigger><SelectContent><SelectItem value="all">All Terms</SelectItem>{terms.map(term => (<SelectItem key={term} value={term}>{term}</SelectItem>))}</SelectContent></Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {studentsLoading ? (
                    <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
                ) : (
                    <StudentTable currentUser={user} users={users} students={filteredStudents} showEmployee={true} showPipelineStatus={true} showIelts={true} showTerm={true} showCountries={true} emptyStateMessage="No applicants match your filters." showApplicationCount={true} />
                )}
            </CardContent>
        </Card>
      </div>
    );
}

// This component fetches and displays student data for Employees
function EmployeeStudentView({ user, users }: { user: User, users: User[] }) {
    if (!user.civilId) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Account Configuration Incomplete</CardTitle>
                    <CardDescription>Your user profile is missing a Civil ID.</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">Please contact an administrator to have your 12-digit Civil ID added to your profile in the <strong>User Management</strong> page. This is required to view your assigned students.</p>
                </CardContent>
            </Card>
        )
    }

    const { firestore } = useFirebase();

    // UI State for filtering
    const [searchQuery, setSearchQuery] = useState('');
    const [pipelineFilter, setPipelineFilter] = useState('all');
    const [ieltsFilter, setIeltsFilter] = useState('all');
    const [termFilter, setTermFilter] = useState('all');

    const termsCollection = useMemoFirebase(() => firestore ? collection(firestore, 'academic_terms') : null, [firestore]);
    const { data: termsData } = useCollection(termsCollection);
    const terms = useMemo(() => termsData?.map(t => t.name) || [], [termsData]);
    
    // Direct query for students assigned to the current employee
    const studentsQuery = useMemoFirebase(() => {
        if (!firestore || !user.civilId) return null;
        return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }, [firestore, user.civilId]);

    const { data: employeeStudents, isLoading: studentsLoading } = useCollection<Student>(studentsQuery);
    
    // Client-side filtering (on the fetched students)
    const filteredStudents = useMemo(() => {
        if (!employeeStudents) return [];

        return employeeStudents.filter(student => {
            const searchLower = searchQuery.toLowerCase();
            const matchesSearch = !searchQuery ||
                                (student.name || '').toLowerCase().includes(searchLower) ||
                                (student.email || '').toLowerCase().includes(searchLower) ||
                                (student.phone || '').toLowerCase().includes(searchLower);

            const studentPipelineStatus = student.pipelineStatus || 'none';
            const matchesPipeline = pipelineFilter === 'all' || studentPipelineStatus === pipelineFilter;
            
            const matchesIelts = (() => {
                const overallScore = student.ielts?.overall;
                if (ieltsFilter === 'all') return true;
                if (ieltsFilter === 'not-set') return overallScore === undefined || overallScore === null;
                if (ieltsFilter === '<4.5') return overallScore !== undefined && overallScore !== null && overallScore < 4.5;
                if (ieltsFilter === '6.5+') return overallScore !== undefined && overallScore !== null && overallScore >= 6.5;
                // For specific scores like '5.0', '5.5', '6.0'
                const ieltsScore = parseFloat(ieltsFilter);
                if (!isNaN(ieltsScore)) return overallScore !== undefined && overallScore !== null && overallScore === ieltsScore;
                return true; 
            })();
            
            const matchesTerm = termFilter === 'all' || student.term === termFilter;

            return matchesSearch && matchesPipeline && matchesIelts && matchesTerm;
        }).sort((a, b) => {
            const hasNotification = (s: Student) => (s.isNewForEmployee || (s.employeeUnreadMessages || 0) > 0 || (s.newDocumentsForEmployee || 0) > 0 || (s.newMissingItemsForEmployee || 0) > 0);
            const hasNotificationA = hasNotification(a);
            const hasNotificationB = hasNotification(b);
            if (hasNotificationA && !hasNotificationB) return -1;
            if (!hasNotificationA && hasNotificationB) return 1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
    }, [searchQuery, pipelineFilter, ieltsFilter, termFilter, employeeStudents]);

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold">My Applicants</h2>
                <div className="flex items-center gap-2">
                    <ImportStudentsDialog currentUser={user} />
                    <Button asChild>
                        <a href="/new-request">
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add a New Student
                        </a>
                    </Button>
                </div>
            </div>
             <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row gap-4 justify-between items-center">
                        <div className="relative w-full md:max-w-sm">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input type="search" placeholder="Search by name, email, or phone..." className="pl-8" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                        </div>
                        <div className="flex gap-2 w-full flex-wrap md:w-auto justify-end">
                            <Select value={pipelineFilter} onValueChange={setPipelineFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by pipeline" /></SelectTrigger><SelectContent><SelectItem value="all">All Pipelines</SelectItem><SelectItem value="green">Green</SelectItem><SelectItem value="orange">Orange</SelectItem><SelectItem value="red">Red</SelectItem><SelectItem value="none">No Status</SelectItem></SelectContent></Select>
                            <Select value={ieltsFilter} onValueChange={setIeltsFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by IELTS" /></SelectTrigger><SelectContent><SelectItem value="all">All IELTS Scores</SelectItem><SelectItem value="not-set">Not Set</SelectItem><SelectItem value="<4.5">Below 4.5</SelectItem><SelectItem value="5.0">5.0</SelectItem><SelectItem value="5.5">5.5</SelectItem><SelectItem value="6.0">6.0</SelectItem><SelectItem value="6.5+">6.5+</SelectItem></SelectContent></Select>
                            <Select value={termFilter} onValueChange={setTermFilter}><SelectTrigger className="w-full sm:w-[180px]"><SelectValue placeholder="Filter by Term" /></SelectTrigger><SelectContent><SelectItem value="all">All Terms</SelectItem>{terms.map(term => (<SelectItem key={term} value={term}>{term}</SelectItem>))}</SelectContent></Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {studentsLoading ? (
                        <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
                    ) : (
                        <StudentTable currentUser={user} users={users} students={filteredStudents} showEmployee={false} showPipelineStatus={true} showIelts={true} showTerm={true} showCountries={true} emptyStateMessage="You have no assigned applicants, or none match your filters." showApplicationCount={true} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

export default function ApplicantsPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  
  if (isUserLoading || usersLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (!user) {
    // This should ideally be handled by a layout redirect, but as a fallback
    return <div className="flex items-center justify-center h-full"><p>Please log in to view this page.</p></div>;
  }

  if (['admin', 'department'].includes(user.role)) {
    return <AdminStudentView user={user} users={users} />;
  }
  
  return <EmployeeStudentView user={user} users={users} />;
}
