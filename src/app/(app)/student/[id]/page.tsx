

'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useDoc, useCollection, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Student, Task } from '@/lib/types';

import { StudentHeader } from '@/components/student/student-header';
import { StudentApplications } from '@/components/student/student-applications';
import { InternalDocuments } from '@/components/student/internal-documents';
import { NotesSection } from '@/components/student/notes-section';
import { TaskHistory } from '@/components/student/task-history';
import { TransferHistory } from '@/components/student/transfer-history';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StudentChat } from '@/components/student/student-chat';
import { MissingItemsSection } from '@/components/student/missing-items-section';
import { ReadinessChecklist } from '@/components/student/readiness-checklist';
import { IeltsCard } from '@/components/student/ielts-card';


function StudentPageContentSkeleton() {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
                <Card>
                    <CardHeader><Skeleton className="h-7 w-48" /></CardHeader>
                    <CardContent><Skeleton className="h-32 w-full" /></CardContent>
                </Card>
                <Card>
                    <CardHeader><Skeleton className="h-7 w-48" /></CardHeader>
                    <CardContent><Skeleton className="h-32 w-full" /></CardContent>
                </Card>
            </div>
            <div className="space-y-6">
                <Card>
                    <CardHeader><Skeleton className="h-7 w-24" /></CardHeader>
                    <CardContent><Skeleton className="h-48 w-full" /></CardContent>
                </Card>
                 <Card>
                    <CardHeader><Skeleton className="h-7 w-24" /></CardHeader>
                    <CardContent><Skeleton className="h-48 w-full" /></CardContent>
                </Card>
            </div>
      </div>
    )
}


export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const router = useRouter();

  const { user: currentUser, isUserLoading } = useUser();

  const { data: student, isLoading: studentIsLoading, error: studentError } = useDoc<Student>('students', studentId);
  const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(currentUser ? 'tasks' : '');
  
  const isLoading = isUserLoading || studentIsLoading || tasksLoading;

  useEffect(() => {
    // When the assigned employee views the page, mark the student as "viewed"
    // by clearing the `isNewForEmployee` flag. This will hide the "New" badge.
    if (student?.isNewForEmployee && currentUser?.civilId === student?.employeeId) {
        const studentDocRef = doc(firestore, 'students', student.id);
        updateDocumentNonBlocking(studentDocRef, { isNewForEmployee: false });
    }
  }, [student, currentUser]);


  if (studentError) {
    return <div className="text-destructive">Error: {studentError.message}</div>
  }
  
  // This check happens after loading, if the student is truly not found or permissions fail
  if (!isLoading && !student) {
    return <div>Student not found or you do not have permission to view this page.</div>;
  }
  
  // Client-side permission check (will run once student data is loaded)
  if (!isLoading && student && currentUser) {
    const isAssignedEmployee = student.employeeId === currentUser.civilId;
    if (currentUser.role === 'employee' && !isAssignedEmployee) {
        router.push('/applicants'); 
        return (
          <div className="flex h-full w-full items-center justify-center">
            <p>Access Denied. You are not assigned to this student.</p>
          </div>
        );
    }
  }

  const canRenderContent = !isLoading && student && currentUser;
  const isAssignedEmployee = canRenderContent && student.employeeId === currentUser.civilId;
  const isAdminOrDept = canRenderContent && ['admin', 'department'].includes(currentUser.role);

  return (
    <div className="space-y-6">
      <StudentHeader student={student} currentUser={currentUser} isLoading={isLoading} />
      
      {isLoading ? <StudentPageContentSkeleton /> : (
        <>
            {canRenderContent && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2 space-y-6">
                    <StudentApplications student={student} />
                    <IeltsCard student={student} currentUser={currentUser} />
                    <InternalDocuments student={student} currentUser={currentUser} title="Employee Documents" allowUpload={isAssignedEmployee ?? false} />
                    <InternalDocuments student={student} currentUser={currentUser} title="Admin/Dept Documents" allowUpload={isAdminOrDept ?? false} />
                    <ReadinessChecklist student={student} currentUser={currentUser} />
                    </div>

                    <div className="space-y-6">
                        <NotesSection student={student} currentUser={currentUser} title="Notes" readOnly={false} />
                        <Card>
                            <CardHeader>
                                <CardTitle>Internal Chat</CardTitle>
                            </CardHeader>
                            <StudentChat student={student} currentUser={currentUser} />
                        </Card>
                        <MissingItemsSection student={student} currentUser={currentUser} />
                        {student.transferHistory && student.transferHistory.length > 0 && (
                            <TransferHistory transferHistory={student.transferHistory} />
                        )}
                    </div>
                </div>
            )}
            
            <TaskHistory tasks={tasks || []} studentId={studentId} />
        </>
      )}
    </div>
  );
}
