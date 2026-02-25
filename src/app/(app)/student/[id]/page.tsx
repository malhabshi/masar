'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useDoc, useCollection, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, where } from 'firebase/firestore';
import type { Student, Task } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { addAdminNote, addEmployeeNote } from '@/lib/actions';

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
  const { toast } = useToast();

  const { user: currentUser, isUserLoading } = useUser();

  const { data: student, isLoading: studentIsLoading, error: studentError } = useDoc<Student>('students', studentId);
  
  const studentTasksQuery = useMemoFirebase(() => {
    if (!currentUser) return [];
    return [where('studentId', '==', studentId)];
  }, [studentId, currentUser]);

  const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(currentUser ? 'tasks' : '', ...studentTasksQuery);
  
  const isLoading = isUserLoading || studentIsLoading || tasksLoading;

  useEffect(() => {
    // When the assigned employee views the page, mark the student as "viewed"
    // by clearing the `isNewForEmployee` flag. This will hide the "New" badge.
    if (student?.isNewForEmployee && currentUser?.civilId === student?.employeeId) {
        const studentDocRef = doc(firestore, 'students', student.id);
        updateDocumentNonBlocking(studentDocRef, { isNewForEmployee: false });
    }
  }, [student, currentUser]);
  
  useEffect(() => {
    if (isLoading || studentError) return;
    if (!currentUser || !student) return;

    // If the current user is an employee, verify they are still assigned to this student.
    // If not, redirect them away to prevent a crash.
    if (currentUser.role === 'employee' && student.employeeId !== currentUser.civilId) {
        toast({
            title: 'Student Transferred',
            description: `This student is no longer assigned to you.`,
            variant: 'destructive',
        });
        router.push('/applicants');
    }
  }, [student, currentUser, isLoading, router, toast, studentError]);


  if (isLoading) {
    return (
        <div className="space-y-6">
            <StudentHeader student={null} currentUser={null} isLoading={true} />
            <StudentPageContentSkeleton />
        </div>
    )
  }

  if (studentError) {
    // If the error is a permission issue and the user is an employee,
    // they've likely lost access. Redirect them gracefully.
    if (studentError.message.includes('permission') && currentUser?.role === 'employee') {
      router.push('/applicants');
      toast({ title: 'Access Denied', description: 'You no longer have access to this student.' });
      return null; // Render nothing while redirecting
    }
    return <div className="text-destructive">Error: {studentError.message}</div>
  }
  
  // This check happens after loading, if the student is truly not found
  if (!student) {
    // The redirection logic now handles the permission error case,
    // so this is primarily for genuinely non-existent student IDs.
    return <div>Student not found or you do not have permission to view this page.</div>;
  }
  
  const canRenderContent = !isLoading && student && currentUser;
  const isAssignedEmployee = canRenderContent && student.employeeId === currentUser.civilId;
  const isAdminOrDept = canRenderContent && ['admin', 'department'].includes(currentUser.role);
  
  const handleAddEmployeeNote = (content: string) => addEmployeeNote(student.id, currentUser.id, content);
  const handleAddAdminNote = (content: string) => addAdminNote(student.id, currentUser.id, content);


  return (
    <div className="space-y-6">
      <StudentHeader student={student} currentUser={currentUser} isLoading={isLoading} />
      
      {canRenderContent && (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
                <div className="lg:col-span-2 space-y-6">
                    <StudentApplications student={student} />
                    <IeltsCard student={student} currentUser={currentUser} />
                    <InternalDocuments student={student} currentUser={currentUser} title="Employee Documents" allowUpload={isAssignedEmployee ?? false} />
                    <InternalDocuments student={student} currentUser={currentUser} title="Admin/Dept Documents" allowUpload={isAdminOrDept ?? false} />
                    <ReadinessChecklist student={student} currentUser={currentUser} />
                    <NotesSection
                        title="Employee Notes"
                        notes={student.employeeNotes || []}
                        canWrite={isAssignedEmployee}
                        onAddNote={handleAddEmployeeNote}
                        placeholder="Add a new employee note..."
                    />
                    {isAdminOrDept && (
                        <NotesSection
                            title="Admin Notes"
                            notes={student.adminNotes || []}
                            canWrite={isAdminOrDept}
                            onAddNote={handleAddAdminNote}
                            placeholder="Add a new internal note..."
                        />
                    )}
                </div>

                <div className="space-y-6">
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
            
            <TaskHistory tasks={tasks || []} studentId={studentId} currentUser={currentUser} isLoading={tasksLoading} />
        </>
      )}
    </div>
  );
}
