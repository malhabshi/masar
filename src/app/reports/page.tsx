'use client';

import { useUser } from '@/hooks/use-user';
import { useFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import type { Student } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Users, FileText, UserPlus, GraduationCap } from 'lucide-react';

export default function ReportsPage() {
  const { user } = useUser();
  const { firestore } = useFirebase();
  const { data: students } = useCollection<Student>(collection(firestore, 'students'));

  const stats = {
    totalStudents: students?.length || 0,
    totalApplications: students?.reduce((acc, s) => acc + (s.applications?.length || 0), 0) || 0,
    unassigned: students?.filter(s => !s.employeeId).length || 0,
    finalized: students?.filter(s => s.finalChoiceUniversity).length || 0,
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Students</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalStudents}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Applications</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalApplications}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Unassigned</CardTitle>
            <UserPlus className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.unassigned}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Finalized</CardTitle>
            <GraduationCap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.finalized}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
