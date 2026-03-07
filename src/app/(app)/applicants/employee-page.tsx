'use client';

import { useUser } from '@/hooks/use-user';
import type { Student, User } from '@/lib/types';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { StudentTable } from '@/components/dashboard/student-table';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { AddStudentDialog } from '@/components/student/add-student-dialog';
import { Loader2, AlertTriangle, Sparkles, FileSpreadsheet } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

export function EmployeeApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);
  const { user: currentUser, isUserLoading } = useUser();

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isEmployee = currentUser?.role === 'employee';
  
  // Guard the path strictly: path is empty until user is identified and has a Civil ID
  const studentsPath = (isMounted && isEmployee && currentUser?.civilId) ? 'students' : '';
  
  const myStudentsQuery = useMemoFirebase(() => {
    if (!studentsPath || !currentUser?.civilId) return [];
    return [where('employeeId', '==', currentUser.civilId)];
  }, [studentsPath, currentUser?.civilId]);

  const {
    data: myStudents,
    isLoading: studentsAreLoading,
    error: studentsError,
  } = useCollection<Student>(studentsPath, ...myStudentsQuery);

  const { data: allUsers, isLoading: usersAreLoading } = useCollection<User>(
    (isMounted && currentUser) ? 'users' : ''
  );

  // Group students into "New" and "Portfolio"
  const newlyAssigned = useMemo(() => (myStudents || []).filter(s => s.isNewForEmployee), [myStudents]);
  const portfolio = useMemo(() => (myStudents || []).filter(s => !s.isNewForEmployee), [myStudents]);

  const handleDownloadExcel = () => {
    if (!myStudents || myStudents.length === 0) return;

    // Excel/CSV Headers
    const headers = [
      "Student Name", 
      "Phone", 
      "Email", 
      "Internal ID", 
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
    const rows = myStudents.map(s => [
      s.name || '',
      s.phone || '',
      s.email || '',
      s.internalNumber || '',
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
    link.setAttribute('download', `my_applicants_${format(new Date(), 'yyyy-MM-dd')}.csv`);
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

  if (!currentUser || !isEmployee) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access Denied</CardTitle>
          <CardDescription>This page is intended for employee accounts.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!currentUser.civilId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Configuration Error</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Your user profile is missing its Civil ID. You cannot view
              assigned students until an administrator corrects your profile.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
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
              Could not load your students. Please ensure you have the correct permissions.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {newlyAssigned.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-blue-700">
                <Sparkles className="h-5 w-5" />
                Newly Assigned Students
              </CardTitle>
              <CardDescription>
                Students recently transferred or assigned to you. Review these profiles to clear their "New" status.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <StudentTable
              students={newlyAssigned}
              currentUser={currentUser}
              allUsers={allUsers || []}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <CardTitle>My Portfolio</CardTitle>
            <CardDescription>
              A filterable list of your assigned students.
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
            <AddStudentDialog source="applicants" />
          </div>
        </CardHeader>
        <CardContent>
          <StudentTable
            students={portfolio}
            currentUser={currentUser}
            allUsers={allUsers || []}
            emptyStateMessage={newlyAssigned.length > 0 ? "All your students are in the 'Newly Assigned' section." : "No students assigned to your portfolio."}
          />
        </CardContent>
      </Card>
    </div>
  );
}
