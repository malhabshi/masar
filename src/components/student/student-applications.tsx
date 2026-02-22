'use client';

import type { Student, Application, ApplicationStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal } from 'lucide-react';
import { useUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { updateApplicationStatus } from '@/lib/actions';
import { AddApplicationDialog } from './add-application-dialog';
import { firestore, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface StudentApplicationsProps {
  student: Student;
}

const statusColors: Record<ApplicationStatus, string> = {
  Pending: 'bg-yellow-500',
  Submitted: 'bg-blue-500',
  'In Review': 'bg-purple-500',
  Accepted: 'bg-green-500',
  Rejected: 'bg-red-500',
};

export function StudentApplications({ student }: StudentApplicationsProps) {
  const { user: currentUser } = useUser();
  const { toast } = useToast();

  const canManageApplications = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const canAddApplications = currentUser?.role === 'admin' || currentUser?.civilId === student.employeeId;

  const handleStatusUpdate = async (university: string, major: string, newStatus: ApplicationStatus) => {
    
    // Call server action (for notifications, etc.)
    const result = await updateApplicationStatus(student.id, university, major, newStatus, student.name, student.employeeId);

    if (result.success) {
      const studentDocRef = doc(firestore, 'students', student.id);
      const updatedApplications = student.applications.map(app => 
        app.university === university && app.major === major
          ? { ...app, status: newStatus, updatedAt: new Date().toISOString() }
          : app
      );
      updateDocumentNonBlocking(studentDocRef, { applications: updatedApplications });
      
      toast({
        title: 'Status Updated',
        description: `Application for ${university} is now ${newStatus}.`
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: result.message
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>University Applications</CardTitle>
      </CardHeader>
      <CardContent>
        {student.applications && student.applications.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>University</TableHead>
                <TableHead>Major</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                {canManageApplications && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {student.applications.map((app, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">{app.university}</TableCell>
                  <TableCell>{app.major}</TableCell>
                  <TableCell>{app.country}</TableCell>
                  <TableCell>
                    <Badge className={`${statusColors[app.status]} text-white`}>{app.status}</Badge>
                  </TableCell>
                  {canManageApplications && (
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(['Pending', 'Submitted', 'In Review', 'Accepted', 'Rejected'] as ApplicationStatus[]).map(status => (
                            <DropdownMenuItem 
                              key={status} 
                              onClick={() => handleStatusUpdate(app.university, app.major, status)}
                              disabled={app.status === status}
                            >
                              Set as {status}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No applications added yet.</p>
        )}
      </CardContent>
      {canAddApplications && (
        <CardFooter className="border-t pt-4">
          <AddApplicationDialog studentId={student.id} />
        </CardFooter>
      )}
    </Card>
  );
}
