
'use client';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { Student, User } from '@/lib/types';
import { FinalizedStudentsTable } from '@/components/dashboard/finalized-students-table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFirebase, useCollection } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';

export default function FinalizedStudentsPage() {
    const { user, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();
    const { firestore } = useFirebase();

    const [employeeFilter, setEmployeeFilter] = useState('all');

    const finalizedStudentsQuery = useMemo(() => {
        if (!firestore) return null;
        if (user?.role === 'employee') {
            return query(
                collection(firestore, 'students'), 
                where('finalChoiceUniversity', '!=', null),
                where('employeeId', '==', user.civilId)
            );
        }
        return query(collection(firestore, 'students'), where('finalChoiceUniversity', '!=', null));
    }, [firestore, user]);

    const { data: students, isLoading: studentsAreLoading } = useCollection<Student>(finalizedStudentsQuery);

    const filteredStudents = useMemo(() => {
        if (!students) return [];
        if (user?.role !== 'admin' && user?.role !== 'department') return students;

        return students.filter(student => {
            const studentEmployeeId = student.employeeId || 'unassigned';
            return employeeFilter === 'all' || studentEmployeeId === employeeFilter;
        });

    }, [students, employeeFilter, user?.role]);
    
    const employees = useMemo(() => users.filter(u => u.role === 'employee'), [users]);

    const isLoading = isUserLoading || usersLoading || studentsAreLoading;
    
    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
    }

    if (!user) {
        return <p>You must be logged in to view this page.</p>
    }

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between">
                <div>
                    <CardTitle>Finalized Students</CardTitle>
                    <CardDescription>Students who have made their final university choice.</CardDescription>
                </div>
                {(user.role === 'admin' || user.role === 'department') && (
                    <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Filter by employee" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Employees</SelectItem>
                            <SelectItem value="unassigned">Unassigned</SelectItem>
                            {employees.map(emp => (<SelectItem key={emp.id} value={emp.civilId || ''}>{emp.name}</SelectItem>))}
                        </SelectContent>
                    </Select>
                )}
            </CardHeader>
            <CardContent>
                <FinalizedStudentsTable 
                    students={filteredStudents as (Student & { finalChoiceUniversity: string; })[]} 
                    users={users} 
                    showEmployee={user.role !== 'employee'} 
                />
            </CardContent>
        </Card>
    );
}
