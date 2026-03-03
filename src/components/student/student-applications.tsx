
'use client';

import { useCallback, useState } from 'react';
import type { Student, Application, ApplicationStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { MoreHorizontal, CheckCircle, Loader2, Trash2, Pencil } from 'lucide-react';
import { useUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { 
  updateApplicationStatus, 
  setStudentFinalChoice, 
  deleteApplication, 
  updateApplicationMajor 
} from '@/lib/actions';
import { AddApplicationDialog } from './add-application-dialog';
import { cn } from '@/lib/utils';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';


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
  
  const [isFinalizing, setIsFinalizing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ from: string; to: Application } | null>(null);
  const [deletingApp, setDeletingApp] = useState<Application | null>(null);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [newMajor, setNewMajor] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);


  const isAdminDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const canAddApplications = isAdminDept;
  const canSetFinalChoice = currentUser?.role === 'employee' && currentUser.civilId === student.employeeId;

  const handleStatusUpdate = useCallback(async (university: string, major: string, newStatus: ApplicationStatus) => {
    const result = await updateApplicationStatus(student.id, university, major, newStatus, student.name, student.employeeId);
    if (result.success) {
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
  }, [student, toast]);

  const confirmAndSetFinal = useCallback(async (app: Application) => {
    if (!currentUser) return;
    setIsFinalizing(app.university);
    setConfirmation(null); // Close dialog
    const result = await setStudentFinalChoice(student.id, app.university, app.major, currentUser.id);
    if (result.success) {
      toast({ title: 'Final Choice Updated', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsFinalizing(null);
  }, [student.id, currentUser, toast]);

  const handleSetFinalClick = (app: Application) => {
    if (student.finalChoiceUniversity && student.finalChoiceUniversity !== app.university) {
        setConfirmation({ from: student.finalChoiceUniversity, to: app });
    } else {
        confirmAndSetFinal(app);
    }
  };

  const handleDeleteApplication = async () => {
    if (!deletingApp || !currentUser) return;
    setIsProcessing(true);
    const result = await deleteApplication(student.id, deletingApp.university, deletingApp.major, currentUser.id);
    if (result.success) {
      toast({ title: 'Application Deleted', description: result.message });
      setDeletingApp(null);
    } else {
      toast({ variant: 'destructive', title: 'Delete Failed', description: result.message });
    }
    setIsProcessing(false);
  };

  const handleUpdateMajor = async () => {
    if (!editingApp || !newMajor.trim() || !currentUser) return;
    setIsProcessing(true);
    const result = await updateApplicationMajor(student.id, editingApp.university, editingApp.major, newMajor.trim(), currentUser.id);
    if (result.success) {
      toast({ title: 'Major Updated', description: result.message });
      setEditingApp(null);
      setNewMajor('');
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsProcessing(false);
  };


  return (
    <>
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
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {student.applications.map((app, index) => {
                  const isFinalChoice = student.finalChoiceUniversity === app.university;
                  return (
                    <TableRow key={index} className={cn(isFinalChoice && 'bg-green-500/10 hover:bg-green-500/10')}>
                      <TableCell className="font-medium flex items-center">
                          {isFinalChoice && <CheckCircle className="h-4 w-4 text-green-600 mr-2" />}
                          {app.university}
                      </TableCell>
                      <TableCell>{app.major}</TableCell>
                      <TableCell>{app.country}</TableCell>
                      <TableCell>
                        <Badge className={`${statusColors[app.status]} text-white`}>{app.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                {isAdminDept && (
                                    <>
                                        {(['Pending', 'Submitted', 'In Review', 'Accepted', 'Rejected'] as ApplicationStatus[]).map(status => (
                                            <DropdownMenuItem 
                                            key={status} 
                                            onClick={() => handleStatusUpdate(app.university, app.major, status)}
                                            disabled={app.status === status}
                                            >
                                            Set as {status}
                                            </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => { setEditingApp(app); setNewMajor(app.major); }}>
                                            <Pencil className="mr-2 h-4 w-4" />
                                            Change Major
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingApp(app)}>
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Delete Application
                                        </DropdownMenuItem>
                                    </>
                                )}
                                {!isAdminDept && (
                                    <DropdownMenuItem disabled>Only Admins can update status</DropdownMenuItem>
                                )}
                                </DropdownMenuContent>
                            </DropdownMenu>
                            {canSetFinalChoice && (
                                <>
                                    {isFinalChoice ? (
                                        <Badge variant="outline" className="border-green-600 text-green-600">Final Choice</Badge>
                                    ) : (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleSetFinalClick(app)}
                                            disabled={isFinalizing !== null}
                                        >
                                            {isFinalizing === app.university && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Set as Final
                                        </Button>
                                    )}
                                </>
                            )}
                          </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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

      {/* Confirmation for switching Final Choice */}
      <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Confirm Final Choice Change</AlertDialogTitle>
                <AlertDialogDescription>
                    Are you sure you want to change the final choice from <strong>{confirmation?.from}</strong> to <strong>{confirmation?.to.university}</strong>?
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmation(null)}>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => confirmation && confirmAndSetFinal(confirmation.to)}>
                    Confirm Change
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmation for Deleting Application */}
      <AlertDialog open={!!deletingApp} onOpenChange={(open) => !open && setDeletingApp(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Delete University Application?</AlertDialogTitle>
                <AlertDialogDescription>
                    Are you sure you want to remove <strong>{deletingApp?.university} ({deletingApp?.major})</strong>? This action cannot be undone.
                    {student.finalChoiceUniversity === deletingApp?.university && (
                        <p className="mt-2 text-destructive font-bold">Note: This is currently the student's finalized choice.</p>
                    )}
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setDeletingApp(null)} disabled={isProcessing}>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                    onClick={handleDeleteApplication} 
                    disabled={isProcessing}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                    Delete Application
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Dialog for Editing Major */}
      <Dialog open={!!editingApp} onOpenChange={(open) => !open && setEditingApp(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Edit Major: {editingApp?.university}</DialogTitle>
                <DialogDescription>
                    Update the major for this application.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="new-major">New Major Name</Label>
                    <Input 
                        id="new-major" 
                        value={newMajor} 
                        onChange={(e) => setNewMajor(e.target.value)} 
                        placeholder="e.g., Data Science"
                    />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setEditingApp(null)} disabled={isProcessing}>Cancel</Button>
                <Button onClick={handleUpdateMajor} disabled={isProcessing || !newMajor.trim()}>
                    {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                    Update Major
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
