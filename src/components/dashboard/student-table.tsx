
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, GraduationCap, ArrowRightLeft, Repeat, MessageSquare, FilePlus, AlertTriangle } from 'lucide-react';
import type { Student, User, PipelineStatus } from '@/lib/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { updateStudentPipelineStatus } from '@/lib/actions';
import { cn } from '@/lib/utils';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';


interface StudentTableProps {
  students: Student[];
  users: User[];
  currentUser: User;
  showEmployee?: boolean;
  showPipelineStatus?: boolean;
  showIelts?: boolean;
  showTerm?: boolean;
  showCountries?: boolean;
  emptyStateMessage?: string;
  showApplicationCount?: boolean;
}

const pipelineStatusStyles: { [key: string]: string } = {
  green: 'bg-green-500 text-primary-foreground',
  orange: 'bg-orange-500 text-primary-foreground',
  red: 'bg-red-500 text-primary-foreground',
  none: 'bg-gray-400 text-primary-foreground',
};
const pipelineStatusLabels: { [key: string]: string } = {
    green: 'Green',
    orange: 'Orange',
    red: 'Red',
    none: 'No Status',
};


export function StudentTable({ students, users, currentUser, showEmployee = false, showPipelineStatus = false, showIelts = false, showTerm = false, showCountries = false, emptyStateMessage = "No students found.", showApplicationCount = false }: StudentTableProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const getEmployeeName = (employeeId: string | null) => {
    if (!employeeId) return 'Unassigned';
    // The employeeId on a student record is the employee's Civil ID
    return users.find(u => u.civilId === employeeId)?.name || 'Unknown Employee';
  };

  const handlePipelineStatusChange = async (studentId: string, status: PipelineStatus) => {
    const student = students.find(s => s.id === studentId);
    if (!student || !currentUser || !firestore) return;

    const result = await updateStudentPipelineStatus(studentId, status, currentUser.name, student.name);
    if (result.success) {
        const studentDocRef = doc(firestore, 'students', studentId);
        updateDocumentNonBlocking(studentDocRef, { pipelineStatus: status });
        toast({ title: 'Status Updated', description: result.message });
    } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
  }

  const numColumns = [showEmployee, showPipelineStatus, showIelts, showApplicationCount, showTerm, showCountries].filter(Boolean).length + 2;

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Student</TableHead>
            {showApplicationCount && <TableHead>Application Tracking</TableHead>}
            {showPipelineStatus && <TableHead>Pipeline</TableHead>}
            {showCountries && <TableHead>Countries</TableHead>}
            {showEmployee && <TableHead>Assigned Employee</TableHead>}
            {showIelts && <TableHead>IELTS Overall</TableHead>}
            {showTerm && <TableHead>Term</TableHead>}
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {students.length > 0 ? (
            students.map((student) => {
              const wasTransferred = student.transferHistory?.some(t => t.fromEmployeeId);
              const applicationCountries = Array.from(new Set(student.applications.map(app => app.country))).join(', ');
              const isCurrentUserAssigned = currentUser.civilId === student.employeeId;
              const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);

              return (
              <TableRow key={student.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      
                      <AvatarFallback>{student?.name?.charAt(0) ?? 'S'}</AvatarFallback>
                    </Avatar>
                    <div>
                      <a href={`/student/${student.id}`} className="hover:underline">
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          <span>{student.name || 'Unknown Student'}</span>
                          {isCurrentUserAssigned && student.isNewForEmployee && (
                              <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>
                          )}
                          {isAdminOrDept && student.unreadUpdates && student.unreadUpdates > 0 && (
                            <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6">
                              <MessageSquare className="h-3 w-3" />
                              <span>{student.unreadUpdates}</span>
                            </Badge>
                          )}
                          {isAdminOrDept && (student.newDocumentsForAdmin || 0) > 0 && (
                            <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500 hover:bg-blue-600">
                              <FilePlus className="h-3 w-3" />
                              <span>{student.newDocumentsForAdmin}</span>
                            </Badge>
                          )}
                          {isCurrentUserAssigned && (student.employeeUnreadMessages || 0) > 0 && (
                            <Badge variant="destructive" className="flex items-center gap-1 p-1 h-6">
                                <MessageSquare className="h-3 w-3" />
                                <span>{student.employeeUnreadMessages}</span>
                            </Badge>
                          )}
                          {isCurrentUserAssigned && (student.newDocumentsForEmployee || 0) > 0 && (
                              <Badge className="flex items-center gap-1 p-1 h-6 bg-blue-500 hover:bg-blue-600">
                                  <FilePlus className="h-3 w-3" />
                                  <span>{student.newDocumentsForEmployee}</span>
                              </Badge>
                          )}
                          {isCurrentUserAssigned && (student.newMissingItemsForEmployee || 0) > 0 && (
                              <Badge className="flex items-center gap-1 p-1 h-6 bg-yellow-500 hover:bg-yellow-500 text-black">
                                  <AlertTriangle className="h-3 w-3" />
                                  <span>{student.newMissingItemsForEmployee}</span>
                              </Badge>
                          )}
                          {student.transferRequested && (
                              <Badge variant="outline" className="border-yellow-500 text-yellow-600">
                                  <ArrowRightLeft className="mr-1 h-3 w-3" />
                                  Transfer Requested
                              </Badge>
                          )}
                          {wasTransferred && (
                              <Badge variant="outline" className="border-blue-500 text-blue-600">
                                  <Repeat className="mr-1 h-3 w-3" />
                                  Transferred
                              </Badge>
                          )}
                        </div>
                      </a>
                      <div className="text-sm text-muted-foreground">{student.email || 'No Email'}</div>
                      <div className="text-sm text-muted-foreground">{student.phone || 'No Phone'}</div>
                      {student.finalChoiceUniversity && (
                        <div className="flex items-center gap-1 text-lg text-success font-bold mt-1">
                          <GraduationCap className="h-5 w-5" />
                          <span>{student.finalChoiceUniversity}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                {showApplicationCount && (
                  <TableCell>
                    <div className="text-center font-medium">{student.applications.length}</div>
                  </TableCell>
                )}
                {showPipelineStatus && (
                  <TableCell>
                    <Badge variant="default" className={cn("capitalize", pipelineStatusStyles[student.pipelineStatus || 'none'])}>
                      {pipelineStatusLabels[student.pipelineStatus || 'none']}
                    </Badge>
                  </TableCell>
                )}
                {showCountries && (
                  <TableCell>
                    {applicationCountries ? (
                      <span>{applicationCountries}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                )}
                {showEmployee && (
                  <TableCell>{getEmployeeName(student.employeeId)}</TableCell>
                )}
                {showIelts && (
                  <TableCell>
                    {student.ielts?.overall ? (
                        <Badge variant="secondary">{student.ielts.overall.toFixed(1)}</Badge>
                    ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                )}
                {showTerm && (
                  <TableCell>
                    {student.term ? (
                        <Badge variant="outline">{student.term}</Badge>
                    ) : (
                        <span className="text-sm text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                      <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal className="h-4 w-4" />
                              </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                  <a href={`/student/${student.id}`}>View Details</a>
                              </DropdownMenuItem>
                              {currentUser?.role === 'employee' && (
                                  <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'green')}>
                                          <span>Move to Green</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'orange')}>
                                          <span>Move to Orange</span>
                                      </DropdownMenuItem>
                                      <DropdownMenuItem onClick={() => handlePipelineStatusChange(student.id, 'red')}>
                                          <span>Move to Red</span>
                                      </DropdownMenuItem>
                                  </>
                              )}
                          </DropdownMenuContent>
                      </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            )})
          ) : (
            <TableRow>
                <TableCell colSpan={numColumns} className="h-24 text-center">
                    {emptyStateMessage}
                </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
