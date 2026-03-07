'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { orderBy } from 'firebase/firestore';
import { StudentTable } from '@/components/dashboard/student-table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { Loader2, FileSpreadsheet } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export function AdminApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'department';
  
  // Guard the path: only query if user role is confirmed as Admin/Dept
  const studentsPath = (isMounted && isAdmin) ? 'students' : '';
  const usersPath = (isMounted && currentUser) ? 'users' : '';

  const studentsConstraints = useMemoFirebase(() => {
    if (!studentsPath) return [];
    return [orderBy('createdAt', 'desc')];
  }, [studentsPath]);

  const { data: allStudents, isLoading: studentsAreLoading } = useCollection<Student>(studentsPath, ...studentsConstraints);
  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(usersPath);

  // Helper to map employee IDs to names for the Excel export
  const employeeMap = useMemo(() => {
    const map = new Map<string, string>();
    allUsers?.forEach(u => {
      if (u.civilId) map.set(u.civilId, u.name);
    });
    return map;
  }, [allUsers]);

  // Requirement: Admins/Dept see ALL students (assigned and unassigned)
  const displayedStudents = useMemo(() => {
    return allStudents || [];
  }, [allStudents]);

  const handleDownloadExcel = () => {
    if (displayedStudents.length === 0) return;

    // Excel/CSV Headers
    const headers = [
      "Student Name", 
      "Phone", 
      "Email", 
      "Internal ID", 
      "Assigned Employee", 
      "Pipeline Status", 
      "Target Countries",
      "University Applications",
      "Missing Items",
      "Final University", 
      "IELTS", 
      "Intake Semester", 
      "Intake Year", 
      "Created Date"
    ];
    
    // Excel/CSV Rows
    const rows = displayedStudents.map(s => [
      s.name || '',
      s.phone || '',
      s.email || '',
      s.internalNumber || '',
      s.employeeId ? (employeeMap.get(s.employeeId) || s.employeeId) : 'Unassigned',
      s.pipelineStatus || 'none',
      (s.targetCountries || []).join('; '),
      (s.applications || []).map(app => `${app.university} (${app.major}) - ${app.status}`).join('; '),
      (s.missingItems || []).join('; '),
      s.finalChoiceUniversity || '',
      s.ieltsOverall ? s.ieltsOverall.toFixed(1) : '0.0',
      s.academicIntakeSemester || '',
      s.academicIntakeYear?.toString() || '',
      s.createdAt ? format(new Date(s.createdAt), 'yyyy-MM-dd') : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `all_applicants_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const dataIsLoading = isUserLoading || studentsAreLoading || usersAreLoading;

  if (!isMounted || dataIsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }
  
  if (!currentUser || !isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>You do not have permission to view the master applicants list.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>Applicants</CardTitle>
            <CardDescription>
              A comprehensive list of all student records in the system.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              onClick={handleDownloadExcel}
              className="gap-2 border-green-600 text-green-700 hover:bg-green-50"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Download Excel
            </Button>
            {['admin', 'employee'].includes(currentUser.role) && <AddStudentDialog source="applicants" />}
          </div>
        </CardHeader>
        <CardContent>
          <StudentTable
            students={displayedStudents}
            currentUser={currentUser}
            allUsers={allUsers || []}
          />
        </CardContent>
      </Card>
    </div>
  );
}
