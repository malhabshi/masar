'use client';

import { useParams } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { useFirebase, useDoc, useCollection } from '@/firebase';
import { doc, collection, query, where } from 'firebase/firestore';
import type { Student, User, RequestType } from '@/lib/types';
import { Loader2, AlertTriangle, GitMerge } from 'lucide-react';
import { useMemo } from 'react';

import { StudentHeader } from '@/components/student/student-header';
import { ApplicationStatus } from '@/components/student/application-status';
import { ProfileCompletionProgress } from '@/components/student/profile-completion-progress';
import { IeltsSection } from '@/components/student/ielts-section';
import { StudentTermSelector } from '@/components/student/student-term-selector';
import { NotesSection } from '@/components/student/notes-section';
import { InternalDocuments } from '@/components/student/internal-documents';
import { MissingItems } from '@/components/student/missing-items';
import { TaskHistory } from '@/components/student/task-history';
import { StudentHistory } from '@/components/student/student-history';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { RequestTransferDialog } from '@/components/student/request-transfer-dialog';
import { DeleteStudentDialog } from '@/components/student/delete-student-dialog';
import { AdminDeleteStudentDialog } from '@/components/student/admin-delete-student-dialog';
import { NewRequestDialog } from '@/components/student/new-request-dialog';
import { InactivityReportDialog } from '@/components/student/inactivity-report-dialog';
import { MergeStudentDialog } from '@/components/student/merge-student-dialog';

export default function StudentProfilePage() {
  const params = useParams();
  const studentId = params.id as string;

  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const studentDocRef = useMemo(() => {
    if (!firestore || !studentId) return null;
    return doc(firestore, 'students', studentId);
  }, [firestore, studentId]);
  const { data: student, isLoading: isStudentLoading } = useDoc<Student>(studentDocRef);

  const requestTypesCollection = useMemo(() => !firestore ? null : collection(firestore, 'request_types'), [firestore]);
  const { data: requestTypes, isLoading: areRequestTypesLoading } = useCollection<RequestType>(requestTypesCollection);

  const duplicateStudentsQuery = useMemo(() => {
      if (!firestore || !student?.phone) return null;
      return query(
          collection(firestore, 'students'), 
          where('phone', '==', student.phone)
      );
  }, [firestore, student?.phone]);
  const { data: duplicateStudentsData, isLoading: duplicatesLoading } = useCollection<Student>(duplicateStudentsQuery);
  const duplicateStudents = useMemo(() => duplicateStudentsData?.filter(s => s.id !== studentId), [duplicateStudentsData, studentId]);

  const isLoading = isUserLoading || isStudentLoading || usersLoading || areRequestTypesLoading || duplicatesLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!student) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardHeader>
          <CardTitle>Student Not Found</CardTitle>
          <CardDescription>The student profile you are looking for does not exist or has been deleted.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild><a href="/applicants">Return to Applicants</a></Button>
        </CardContent>
      </Card>
    );
  }

  if (!currentUser) {
      return <p>Please log in to view this page.</p>
  }
  
  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  const isAdmin = currentUser.role === 'admin';
  const isDepartment = currentUser.role === 'department';
  const canViewProfile = isAssignedEmployee || isAdmin || isDepartment;

  if (!canViewProfile) {
    return (
      <Card className="max-w-xl mx-auto">
        <CardHeader>
          <CardTitle>Permission Denied</CardTitle>
          <CardDescription>You do not have permission to view this student's profile.</CardDescription>
        </CardHeader>
        <CardContent>
           <Button asChild><a href="/dashboard">Return to Dashboard</a></Button>
        </CardContent>
      </Card>
    );
  }

  const lastNoteDate = student.notes?.length > 0
    ? new Date(Math.max(...student.notes.map(n => new Date(n.createdAt).getTime())))
    : new Date(student.createdAt);
  const daysSinceLastActivity = (new Date().getTime() - lastNoteDate.getTime()) / (1000 * 3600 * 24);
  const isInactivityAlert = isAssignedEmployee && daysSinceLastActivity > 10;
  
  return (
    <div className="space-y-6">
      <StudentHeader student={student} currentUser={currentUser} />

      {isInactivityAlert && (
          <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Inactivity Alert</AlertTitle>
              <AlertDescription>
                  There has been no activity on this student's profile for over 10 days. Please provide an update by adding a note or submitting an inactivity report.
                  <InactivityReportDialog student={student} currentUser={currentUser} users={users} />
              </AlertDescription>
          </Alert>
      )}

      {student.deletionRequested && isAdmin && (
          <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Deletion Requested</AlertTitle>
              <AlertDescription className="flex justify-between items-center">
                  The assigned employee has requested to delete this student profile.
                  <AdminDeleteStudentDialog student={student} users={users} currentUser={currentUser} />
              </AlertDescription>
          </Alert>
      )}

      {duplicateStudents && duplicateStudents.length > 0 && isAdmin && (
          <Alert>
              <GitMerge className="h-4 w-4" />
              <AlertTitle>Potential Duplicate Found</AlertTitle>
              <AlertDescription className="flex justify-between items-center">
                  A profile for {duplicateStudents[0].name} with the same phone number exists. You can merge the two profiles.
                  <MergeStudentDialog primaryStudent={student} secondaryStudent={duplicateStudents[0]} />
              </AlertDescription>
          </Alert>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <ApplicationStatus student={student} currentUser={currentUser} />
          <NotesSection student={student} currentUser={currentUser} users={users} title="Employee Notes & Activity Log" readOnly={!isAssignedEmployee && !isAdmin} noteFilter="employee" />
          {isAdmin && (
             <NotesSection student={student} currentUser={currentUser} users={users} title="Admin & Department Notes" readOnly={false} noteFilter="admin" />
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-2">
                {isAssignedEmployee && <NewRequestDialog student={student} currentUser={currentUser} users={users} requestTypes={requestTypes || []} />}
                {isAssignedEmployee && <RequestTransferDialog student={student} currentUser={currentUser} users={users} />}
                {isAssignedEmployee && <DeleteStudentDialog student={student} currentUser={currentUser} />}
            </CardContent>
          </Card>
          <ProfileCompletionProgress student={student} currentUser={currentUser} />
          <IeltsSection student={student} currentUser={currentUser} />
          <StudentTermSelector student={student} currentUser={currentUser} />
          <MissingItems student={student} currentUser={currentUser} />
        </div>
      </div>

      <div className="space-y-6">
        <InternalDocuments student={student} currentUser={currentUser} users={users} title="Employee Documents" allowUpload={isAssignedEmployee} />
        <InternalDocuments student={student} currentUser={currentUser} users={users} title="Management Documents" allowUpload={isAdmin || isDepartment} />
        <TaskHistory student={student} users={users} currentUser={currentUser} />
        {(student.transferHistory && student.transferHistory.length > 0) && <StudentHistory student={student} users={users} />}
      </div>
    </div>
  );
}
