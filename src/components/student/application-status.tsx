'use client';

import type { Application, ApplicationStatus, Student, User } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { updateApplicationStatus, setFinalChoice } from '@/lib/actions';
import { Globe, CheckCircle, GraduationCap } from 'lucide-react';
import { AddApplicationDialog } from './add-application-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

const statusColors: Record<ApplicationStatus, string> = {
  Pending: 'bg-gray-400',
  Submitted: 'bg-blue-500',
  'In Review': 'bg-yellow-500',
  Accepted: 'bg-green-500',
  Rejected: 'bg-red-500',
};

const statusOptions: ApplicationStatus[] = ['Pending', 'Submitted', 'In Review', 'Accepted', 'Rejected'];

interface ApplicationStatusProps {
  student: Student;
  currentUser: User;
}

export function ApplicationStatus({ student, currentUser }: ApplicationStatusProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const canUpdate = ['admin', 'department'].includes(currentUser.role);
  const canSetFinalChoice = currentUser.civilId === student.employeeId;

  const handleStatusChange = async (appIndex: number, newStatus: ApplicationStatus) => {
    if (!canUpdate) {
      toast({
        variant: 'destructive',
        title: 'Permission Denied',
        description: 'You do not have permission to update the status.',
      });
      return;
    }
    
    const app = student.applications[appIndex];
    if (!app || !firestore) return;

    // Optimistic update via non-blocking write
    const studentDocRef = doc(firestore, 'students', student.id);
    const updatedApplications = [...student.applications];
    updatedApplications[appIndex] = { ...app, status: newStatus, updatedAt: new Date().toISOString() };
    updateDocumentNonBlocking(studentDocRef, { applications: updatedApplications });

    // Server action for notifications etc.
    const result = await updateApplicationStatus(student.id, app.university, app.major, newStatus, student.name, student.employeeId);
    if (result.success) {
      toast({
        title: 'Status Updated',
        description: result.message,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: result.message,
      });
      // UI will automatically revert on next Firestore snapshot if write fails
    }
  };

  const handleSetFinalChoice = async (university: string) => {
    if (!firestore) return;
    const studentDocRef = doc(firestore, 'students', student.id);
    const previousChoice = student.finalChoiceUniversity;
    
    // Optimistic update
    updateDocumentNonBlocking(studentDocRef, { finalChoiceUniversity: university });
    
    // Server action
    const result = await setFinalChoice(student.id, university, currentUser.id, student.name);
     if (result.success) {
      toast({
        title: 'Final Choice Set!',
        description: result.message,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: result.message,
      });
      // Revert
      updateDocumentNonBlocking(studentDocRef, { finalChoiceUniversity: previousChoice });
    }
  }
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Application Tracking</CardTitle>
        {canUpdate && <AddApplicationDialog studentId={student.id} />}
      </CardHeader>
      <CardContent className="space-y-6">
        {student.applications.map((app, index) => {
          const isFinalChoice = student.finalChoiceUniversity === app.university;
          return (
            <div key={index} className={cn("flex flex-col md:flex-row md:items-center gap-4 p-4 rounded-lg", isFinalChoice && "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800")}>
              <div className="flex-1">
                <div className="font-semibold text-base flex items-center gap-2">
                    {app.university}
                    {isFinalChoice && <Badge variant="default" className="bg-green-600 hover:bg-green-700"><CheckCircle className="h-4 w-4 mr-1" /> Final Choice</Badge>}
                </div>
                <div className="text-sm font-medium text-muted-foreground">{app.major}</div>
                <div className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
                  <Globe className="h-4 w-4"/>
                  <span>{app.country}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                      <div className={`w-3 h-3 rounded-full ${statusColors[app.status]}`}></div>
                      <span>{app.status}</span>
                  </div>
                  <Select
                      defaultValue={app.status}
                      onValueChange={(value) => handleStatusChange(index, value as ApplicationStatus)}
                      disabled={!canUpdate}
                  >
                      <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Update status" />
                      </SelectTrigger>
                      <SelectContent>
                      {statusOptions.map(option => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                      ))}
                      </SelectContent>
                  </Select>
                  {canSetFinalChoice && !isFinalChoice && (
                    <Button variant="outline" size="sm" onClick={() => handleSetFinalChoice(app.university)}>
                      <GraduationCap className="mr-2 h-4 w-4" />
                      Set as Final
                    </Button>
                  )}
              </div>
            </div>
          )
        })}
        {student.applications.length === 0 && (
            <p className="text-muted-foreground text-center py-8">No applications submitted yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
