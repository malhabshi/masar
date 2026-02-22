
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Student } from '@/lib/types';
import { Plane } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useUsers } from '@/contexts/users-provider';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

interface FinalizedStudentsTableProps {
  students: FinalizedStudent[];
  showEmployee?: boolean;
}

export function FinalizedStudentsTable({ students, showEmployee = true }: FinalizedStudentsTableProps) {
  const { getUserByCivilId } = useUsers();
  
  const getEmployeeName = (employeeId: string | null) => {
    if (!employeeId) return 'Unassigned';
    const employee = getUserByCivilId(employeeId);
    return employee?.name || 'Unknown Employee';
  };

  const getUniversityCountry = (student: FinalizedStudent) => {
    const application = student.applications.find(app => app.university === student.finalChoiceUniversity);
    return application?.country || 'N/A';
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            <TableHead>Final Choice University</TableHead>
            <TableHead>Country</TableHead>
            {showEmployee && <TableHead>Assigned Employee</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.length > 0 ? (
            students.map((student) => (
              <TableRow key={student.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={student.avatarUrl} alt={student.name} data-ai-hint="student avatar" />
                      <AvatarFallback>{student.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{student.name}</span>
                        {student.profileCompletionStatus?.readyToTravel && (
                            <Badge variant="outline" className="border-success text-success font-normal">
                                <Plane className="mr-1 h-3 w-3" />
                                Ready to travel
                            </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">{student.email}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{student.finalChoiceUniversity}</TableCell>
                <TableCell>{getUniversityCountry(student)}</TableCell>
                {showEmployee && <TableCell>{getEmployeeName(student.employeeId)}</TableCell>}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={showEmployee ? 4 : 3} className="h-24 text-center">
                No students match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
