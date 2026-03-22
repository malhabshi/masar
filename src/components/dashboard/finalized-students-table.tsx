
'use client';

import { useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Student } from '@/lib/types';
import { Plane, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

interface FinalizedStudentsTableProps {
  students: FinalizedStudent[];
  showEmployee?: boolean;
  currentUserId?: string;
}

export function FinalizedStudentsTable({ students, showEmployee = true, currentUserId }: FinalizedStudentsTableProps) {
  const employeeCivilIds = useMemo(() => {
    if (!showEmployee) return [];
    return [...new Set(students.map(s => s.employeeId).filter((id): id is string => !!id))];
  }, [students, showEmployee]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  const getEmployeeName = (employeeId: string | null) => {
    if (!employeeId) return 'Unassigned';
    const employee = employeeMap.get(employeeId);
    return employee?.name || '...';
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
            <TableHead>Finalized Date</TableHead>
            {showEmployee && <TableHead>Intake Term</TableHead>}
            {showEmployee && <TableHead>Assigned Employee</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.length > 0 ? (
            students.map((student) => (
              <TableRow key={student.id}>
                <TableCell>
                  <div>
                    <div className="flex items-center gap-2">
                      {student.internalNumber && (
                        <span className="text-[10px] font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          #{student.internalNumber}
                        </span>
                      )}
                      <span className="font-medium">{student.name}</span>
                      {currentUserId && (!student.finalizedViewedBy || !student.finalizedViewedBy.includes(currentUserId)) && (
                        <Badge className="bg-yellow-500 text-white animate-pulse text-[9px] h-4 px-1">NEW</Badge>
                      )}
                      {student.profileCompletionStatus?.readyToTravel && (
                          <Badge variant="outline" className="border-success text-success font-normal">
                              <Plane className="mr-1 h-3 w-3" />
                              Ready to travel
                          </Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">{student.email}</div>
                  </div>
                </TableCell>
                <TableCell className="font-medium">{student.finalChoiceUniversity}</TableCell>
                <TableCell>{getUniversityCountry(student)}</TableCell>
                <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                   {student.finalizedAt ? new Date(student.finalizedAt).toLocaleDateString() : 'N/A'}
                </TableCell>
                {showEmployee && (
                  <TableCell>
                    {student.academicIntakeSemester ? (
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="h-3 w-3 text-primary" />
                        <span className="text-sm font-medium">{student.academicIntakeSemester} {student.academicIntakeYear}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not set</span>
                    )}
                  </TableCell>
                )}
                {showEmployee && <TableCell>{getEmployeeName(student.employeeId)}</TableCell>}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={showEmployee ? 6 : 4} className="h-24 text-center">
                No students match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
