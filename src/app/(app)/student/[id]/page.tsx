'use client';

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { Student } from '@/lib/types';

import { Loader2 } from 'lucide-react';
import { StudentHeader } from '@/components/student/student-header';
import { StudentApplications } from '@/components/student/student-applications';
import { InternalDocuments } from '@/components/student/internal-documents';
import { NotesSection } from '@/components/student/notes-section';
import { TaskHistory } from '@/components/student/task-history';
import { TransferHistory } from '@/components/student/transfer-history';

export default function StudentDetailPage() {
  const params = useParams();
  const studentId = params.id as string;
  const router = useRouter();

  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const studentDocRef = useMemoFirebase(() => {
    if (!firestore || !studentId) return null;
    return doc(firestore, 'students', studentId);
  }, [firestore, studentId]);

  const { data: student, isLoading: studentIsLoading, error: studentError } = useDoc<Student>(studentDocRef);
  
  const isLoading = isUserLoading || usersLoading || studentIsLoading;

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (studentError) {
    return <div className="text-destructive">Error: {studentError.message}</div>
  }
  
  if (!student || !currentUser) {
    // This can happen briefly during data loading or if the student doesn't exist.
    return <div>Student not found or you do not have permission to view this page.</div>;
  }
  
  const isAssignedEmployee = student.employeeId === currentUser.civilId;
  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);

  // Enforce permissions client-side
  if (currentUser.role === 'employee' && !isAssignedEmployee) {
      // Redirect if an employee tries to access a student not assigned to them.
      router.push('/applicants'); 
      return (
        <div className="flex h-full w-full items-center justify-center">
          <p>Access Denied. You are not assigned to this student.</p>
        </div>
      );
  }

  return (
    <div className="space-y-6">
      <StudentHeader student={student} currentUser={currentUser} />
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
           <StudentApplications student={student} />
           <InternalDocuments student={student} currentUser={currentUser} users={users} title="Employee Documents" allowUpload={isAssignedEmployee} />
           <InternalDocuments student={student} currentUser={currentUser} users={users} title="Admin/Dept Documents" allowUpload={isAdminOrDept} />
        </div>

        <div className="space-y-6">
            <NotesSection student={student} currentUser={currentUser} users={users} title="Notes" readOnly={false} />
            {student.transferHistory && student.transferHistory.length > 0 && (
                <TransferHistory transferHistory={student.transferHistory} users={users} />
            )}
        </div>
      </div>
      
      <TaskHistory student={student} currentUser={currentUser} users={users} />
    </div>
  );
}
