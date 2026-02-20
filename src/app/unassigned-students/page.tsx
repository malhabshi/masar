'use client';

import { useUser } from '@/hooks/use-user';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import type { Student } from '@/lib/types';
import { StudentTable } from '@/components/dashboard/student-table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function UnassignedStudentsPage() {
  const { user, isUserLoading } = useUser();
  const { firestore } = useFirebase();
  
  const studentsQuery = query(
    collection(firestore, 'students'),
    where('employeeId', '==', null)
  );
  
  const { data: students, isLoading } = useCollection<Student>(studentsQuery);

  if (isUserLoading || isLoading) {
    return <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Unassigned Students</CardTitle>
        </CardHeader>
        <CardContent>
          <StudentTable 
            students={students || []} 
            users={[]} 
            currentUser={user} 
            showEmployee 
            showPipelineStatus 
          />
        </CardContent>
      </Card>
    </div>
  );
}
