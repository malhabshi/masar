
'use client';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { StudentChat } from '@/components/student/student-chat';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState, useMemo } from 'react';
import type { Student } from '@/lib/types';
import { Loader2 } from 'lucide-react';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';


export default function InternalChatPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  const studentsQuery = useMemo(() => {
    if (!firestore) return null;
    if (user?.role === 'employee') {
      return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }
    // Admins and Departments see all students
    return collection(firestore, 'students');
  }, [firestore, user]);

  const { data: students, isLoading: studentsAreLoading } = useCollection<Student>(studentsQuery);

  const selectedStudent = useMemo(() => {
    return students?.find(s => s.id === selectedStudentId) || null;
  }, [students, selectedStudentId]);

  const isLoading = isUserLoading || usersLoading || studentsAreLoading;
  
  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }

  if (!user || !students) {
    return <div>Could not load user or student data.</div>
  }
  
  return (
    <div className="max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <CardTitle>Internal Chat</CardTitle>
            <Select onValueChange={setSelectedStudentId} value={selectedStudentId || undefined}>
                <SelectTrigger className="w-full sm:w-[280px]">
                    <SelectValue placeholder="Select a student to start chatting" />
                </SelectTrigger>
                <SelectContent>
                    {students.map(student => (
                        <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
          </div>
        </CardHeader>
        {selectedStudent ? (
          <StudentChat student={selectedStudent} currentUser={user} users={users} />
        ) : (
          <div className="h-96 flex items-center justify-center text-muted-foreground">
            <p>Select a student to view the chat history.</p>
          </div>
        )}
      </Card>
    </div>
  );
}
