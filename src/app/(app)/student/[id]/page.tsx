'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useDoc, useCollection, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, where, query, collection, or, and } from 'firebase/firestore';
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
import { GradeCard } from '@/components/student/grade-card';
import { StudentUsersCard } from '@/components/student/student-users-card';
import { DuplicateWarningBanner } from '@/components/student/duplicate-warning-banner';
import { AcademicIntakeCard } from '@/components/student/academic-intake-card';
import { TargetCountriesCard } from '@/components/student/target-countries-card';
import { TaskStatsCard } from '@/components/student/task-stats-card';
import { InactivityReportSection } from '@/components/student/inactivity-report-section';
import { AssignmentCard } from '@/components/student/assignment-card';
import { StatusNoteCard } from '@/components/student/status-note-card';
import { AdminStatusNoteCard } from '@/components/student/admin-status-note-card';
import { JotformCard } from '@/components/student/jotform-card';

function playLoudAlert() {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    const ctx = new window.AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.5);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 1.0);
    
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 2.0);
    
    osc.start();
    osc.stop(ctx.currentTime + 2.0);
  } catch (e) {
    console.error("Audio playback failed:", e);
  }
}

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
    );
}


export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const router = useRouter();
  const { toast } = useToast();

  const { user: currentUser, isUserLoading } = useUser();

  const { data: student, isLoading: studentIsLoading, error: studentError } = useDoc<Student>('students', studentId);
  
  const studentTasksQuery = useMemoFirebase(() => {
    if (!currentUser || !studentId) return null;
    
    const studentConstraint = where('studentId', '==', studentId);
    
    // For employees, we need to see tasks they sent AND tasks they are meant to receive
    if (currentUser.role === 'employee') {
      return query(
        collection(firestore, 'tasks'),
        and(
          studentConstraint,
          or(
            where('authorId', '==', currentUser.id),
            where('recipientIds', 'array-contains', currentUser.id)
          )
        )
      );
    }
    
    // For admins/departments, show all tasks for this student
    return query(collection(firestore, 'tasks'), studentConstraint);
  }, [studentId, currentUser]);

  const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(studentTasksQuery);
  
  const isLoading = isUserLoading || studentIsLoading || tasksLoading;

  useEffect(() => {
    if (student?.isNewForEmployee && currentUser?.civilId === student?.employeeId) {
        const studentDocRef = doc(firestore, 'students', student.id);
        updateDocumentNonBlocking(studentDocRef, { isNewForEmployee: false });
    }
  }, [student, currentUser]);

  useEffect(() => {
    if (student?.changeAgentRequired) {
      playLoudAlert();
    }
  }, [student?.id, student?.changeAgentRequired]);
  
  useEffect(() => {
    if (isLoading || studentError) return;
    if (!currentUser || !student) return;

    if (currentUser.role === 'employee') {
        if (student.employeeId !== currentUser.civilId) {
            toast({
                title: 'Access Restricted',
                description: `This student is not assigned to your portfolio.`,
                variant: 'destructive',
            });
            router.push('/applicants');
        }
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
    if (studentError.message.toLowerCase().includes('permission') && currentUser?.role === 'employee') {
      router.push('/applicants');
      toast({ title: 'Access Denied', description: 'You no longer have access to this student.' });
      return null;
    }
    return <div className="text-destructive p-8 text-center bg-card rounded-lg border">Error: {studentError.message}</div>
  }
  
  if (!student) {
    return <div className="p-8 text-center bg-card rounded-lg border">Student not found or you do not have permission to view this page.</div>;
  }

  if (!currentUser) {
    return <div className="p-8 text-center bg-card rounded-lg border">Please sign in to view student details.</div>;
  }
  
  const isAssignedEmployee = student.employeeId === currentUser.civilId;
  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);
  const isAdminOnly = currentUser.role === 'admin';
  
  const handleAddEmployeeNote = async (content: string) => {
    if (!student || !currentUser) return { success: false, message: 'Missing context' };
    return addEmployeeNote(student.id, currentUser.id, content);
  };

  const handleAddAdminNote = async (content: string) => {
    if (!student || !currentUser) return { success: false, message: 'Missing context' };
    return addAdminNote(student.id, currentUser.id, content);
  };


  return (
    <div className="space-y-6" id="student-profile-content">
      <StudentHeader student={student} currentUser={currentUser} isLoading={isLoading} />
      
      {/* Dynamic Duplicate Warning - Unconditional check within component */}
      <div className="pdf-hide">
        <DuplicateWarningBanner student={student} currentUser={currentUser} />
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <StatusNoteCard student={student} currentUser={currentUser} />
                {isAdminOnly && <AdminStatusNoteCard student={student} currentUser={currentUser} />}
              </div>
              <div className="pdf-hide">
                <InactivityReportSection student={student} currentUser={currentUser} />
              </div>
              <TargetCountriesCard student={student} currentUser={currentUser} />
              <StudentApplications student={student} />
              <StudentUsersCard student={student} currentUser={currentUser} />
              <InternalDocuments student={student} currentUser={currentUser} title="Employee Documents" allowUpload={isAssignedEmployee} />
              <InternalDocuments student={student} currentUser={currentUser} title="Admin/Dept Documents" allowUpload={isAdminOrDept} />
              
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
              {currentUser.role === 'admin' && (
                <div className="pdf-hide">
                  <AssignmentCard student={student} />
                </div>
              )}
              <div className="pdf-hide">
                <TaskStatsCard tasks={tasks || []} />
              </div>
              <ReadinessChecklist student={student} currentUser={currentUser} />
              <MissingItemsSection student={student} currentUser={currentUser} />
              <JotformCard student={student} currentUser={currentUser} />
              <AcademicIntakeCard student={student} currentUser={currentUser} />
              <GradeCard student={student} currentUser={currentUser} />
              <IeltsCard student={student} currentUser={currentUser} />
              
              <NotesSection
                  title="Employee Notes"
                  notes={student.employeeNotes || []}
                  canWrite={isAssignedEmployee}
                  onAddNote={handleAddEmployeeNote}
                  placeholder="Add a new employee note..."
              />

              <Card className="pdf-hide">
                  <CardHeader>
                      <CardTitle>Internal Chat</CardTitle>
                  </CardHeader>
                  <StudentChat student={student} currentUser={currentUser} />
              </Card>
              
              {student.transferHistory && student.transferHistory.length > 0 && (
                  <TransferHistory transferHistory={student.transferHistory} />
              )}
          </div>
      </div>
      
      <div className="pdf-hide">
        <TaskHistory tasks={tasks || []} studentId={student.id} currentUser={currentUser} isLoading={tasksLoading} />
      </div>
    </div>
  );
}
