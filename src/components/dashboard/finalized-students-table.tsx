
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
import { Plane, Calendar, MoreHorizontal, XCircle, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { unfinalizeStudentDecision } from '@/lib/actions';
import { useUser } from '@/hooks/use-user';
import { 
    AlertDialog, 
    AlertDialogAction, 
    AlertDialogCancel, 
    AlertDialogContent, 
    AlertDialogDescription, 
    AlertDialogFooter, 
    AlertDialogHeader, 
    AlertDialogTitle, 
    AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { useState } from 'react';

interface FinalizedStudent extends Student {
  finalChoiceUniversity: string;
}

interface FinalizedStudentsTableProps {
  students: FinalizedStudent[];
  showEmployee?: boolean;
  currentUserId?: string;
}

export function FinalizedStudentsTable({ students, showEmployee = true, currentUserId }: FinalizedStudentsTableProps) {
  const { toast } = useToast();
  const { user: currentUser } = useUser();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
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
            <TableHead className="text-right">Actions</TableHead>
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
                <TableCell className="text-right">
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                                <RotateCcw className="h-4 w-4" />
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Remove from Finalized List?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    This will remove <strong>{student.name}</strong> from the finalized list and reset their choice of <strong>{student.finalChoiceUniversity}</strong>.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction 
                                    className="bg-destructive text-white hover:bg-destructive/90"
                                    onClick={async () => {
                                        if (!currentUser) return;
                                        setIsProcessing(student.id);
                                        const result = await unfinalizeStudentDecision(student.id, currentUser.id);
                                        if (result.success) {
                                            toast({ title: 'Student Removed', description: result.message });
                                        } else {
                                            toast({ variant: 'destructive', title: 'Error', description: result.message });
                                        }
                                        setIsProcessing(null);
                                    }}
                                >
                                    Proceed
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={showEmployee ? 7 : 5} className="h-24 text-center">
                No students match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
