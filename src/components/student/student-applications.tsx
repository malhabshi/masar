'use client';

import { useCallback, useState, useMemo } from 'react';
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
import { MoreHorizontal, CheckCircle, Loader2, Trash2, Pencil, AlertCircle, CheckSquare, Layers } from 'lucide-react';
import { useUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { 
  updateApplicationStatus, 
  setStudentFinalChoice, 
  deleteApplication, 
  updateApplicationMajor,
  bulkUpdateApplicationStatuses
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
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';


interface StudentApplicationsProps {
  student: Student;
}

const statusColors: Record<ApplicationStatus, string> = {
  Pending: 'bg-yellow-500',
  Submitted: 'bg-blue-500',
  'Missing Items': 'bg-purple-500',
  Accepted: 'bg-green-500',
  Rejected: 'bg-red-500',
};

const ALL_STATUSES: ApplicationStatus[] = ['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'];

export function StudentApplications({ student }: StudentApplicationsProps) {
  const { user: currentUser } = useUser();
  const { toast } = useToast();
  
  const [isFinalizing, setIsFinalizing] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ from: string; to: Application } | null>(null);
  const [deletingApp, setDeletingApp] = useState<Application | null>(null);
  const [editingApp, setEditingApp] = useState<Application | null>(null);
  const [newMajor, setNewMajor] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Selection state
  const [selectedApps, setSelectedApps] = useState<Set<string>>(new Set());
  const [bulkStatusDialog, setBulkStatusDialog] = useState<ApplicationStatus | null>(null);
  const [bulkRejectionReason, setBulkRejectionReason] = useState('');

  // Rejection Reason state
  const [rejectionDialog, setRejectionDialog] = useState<{ university: string; major: string } | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');


  const isAdminDept = currentUser?.role === 'admin' || currentUser?.role === 'department';
  const canAddApplications = isAdminDept;
  const canSetFinalChoice = currentUser?.role === 'employee' && currentUser.civilId === student.employeeId;

  const toggleSelect = (university: string, major: string) => {
    const key = `${university}|${major}`;
    const newSelected = new Set(selectedApps);
    if (newSelected.has(key)) newSelected.delete(key);
    else newSelected.add(key);
    setSelectedApps(newSelected);
  };

  const toggleAll = () => {
    if (selectedApps.size === student.applications.length) {
      setSelectedApps(new Set());
    } else {
      setSelectedApps(new Set(student.applications.map(a => `${a.university}|${a.major}`)));
    }
  };

  const handleStatusUpdate = useCallback(async (university: string, major: string, newStatus: ApplicationStatus, reason?: string) => {
    setIsProcessing(true);
    const result = await updateApplicationStatus(student.id, university, major, newStatus, student.name, student.employeeId, reason);
    if (result.success) {
      toast({
        title: 'Status Updated',
        description: `Application for ${university} is now ${newStatus}.`
      });
      setRejectionDialog(null);
      setRejectionReason('');
    } else {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: result.message
      });
    }
    setIsProcessing(false);
  }, [student, toast]);

  const handleBulkStatusUpdate = async () => {
    if (!bulkStatusDialog || selectedApps.size === 0 || !currentUser) return;
    
    setIsProcessing(true);
    const updates = Array.from(selectedApps).map(key => {
      const [uni, major] = key.split('|');
      return { 
        university: uni, 
        major, 
        status: bulkStatusDialog,
        rejectionReason: bulkStatusDialog === 'Rejected' ? bulkRejectionReason : undefined
      };
    });

    const result = await bulkUpdateApplicationStatuses(student.id, updates, currentUser.id);
    if (result.success) {
      toast({ title: 'Bulk Update Success', description: result.message });
      setSelectedApps(new Set());
      setBulkStatusDialog(null);
      setBulkRejectionReason('');
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsProcessing(false);
  };

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>University Applications</CardTitle>
          {selectedApps.size > 0 && isAdminDept && (
            <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
              <span className="text-[10px] font-black uppercase text-muted-foreground mr-2">
                {selectedApps.size} Selected
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 gap-2 bg-primary text-white font-bold">
                    <Layers className="h-3.5 w-3.5" />
                    Bulk Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {ALL_STATUSES.map(s => (
                    <DropdownMenuItem key={s} onClick={() => setBulkStatusDialog(s)}>
                      Set all to {s}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {student.applications && student.applications.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  {isAdminDept && (
                    <TableHead className="w-10">
                      <Checkbox 
                        checked={selectedApps.size === student.applications.length && student.applications.length > 0} 
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                  )}
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
                  const key = `${app.university}|${app.major}`;
                  return (
                    <TableRow key={index} className={cn(isFinalChoice && 'bg-green-500/10 hover:bg-green-500/10')}>
                      {isAdminDept && (
                        <TableCell>
                          <Checkbox 
                            checked={selectedApps.has(key)} 
                            onCheckedChange={() => toggleSelect(app.university, app.major)}
                          />
                        </TableCell>
                      )}
                      <TableCell className="font-medium align-top">
                          <div className="flex flex-col">
                            <div className="flex items-center">
                                {isFinalChoice && <CheckCircle className="h-4 w-4 text-green-600 mr-2" />}
                                {app.university}
                            </div>
                            {app.status === 'Rejected' && app.rejectionReason && (
                                <div className="mt-1 flex items-start gap-1.5 text-red-600">
                                    <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                                    <span className="text-[10px] italic font-medium leading-tight">
                                        Reason: {app.rejectionReason}
                                    </span>
                                </div>
                            )}
                          </div>
                      </TableCell>
                      <TableCell className="align-top">{app.major}</TableCell>
                      <TableCell className="align-top">{app.country}</TableCell>
                      <TableCell className="align-top">
                        <Badge className={`${statusColors[app.status]} text-white`}>{app.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right align-top">
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
                                        {(['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'] as ApplicationStatus[]).map(status => (
                                            <DropdownMenuItem 
                                            key={status} 
                                            onClick={() => {
                                                if (status === 'Rejected') {
                                                    setRejectionDialog({ university: app.university, major: app.major });
                                                } else {
                                                    handleStatusUpdate(app.university, app.major, status);
                                                }
                                            }}
                                            disabled={app.status === status}
                                            >
                                            Set as {status}
                                            </DropdownMenuItem>
                                        ))}
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={() => { setEditingApp(app); setNewMajor(app.major); }}>
                                            < Pencil className="mr-2 h-4 w-4" />
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

      {/* Rejection Reason Dialog */}
      <Dialog open={!!rejectionDialog} onOpenChange={(open) => !open && setRejectionDialog(null)}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Reason for Rejection</DialogTitle>
                <DialogDescription>
                    Please provide a reason for the rejection of <strong>{rejectionDialog?.university}</strong>. This will be visible to the assigned employee.
                </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="rejection-reason">Reason</Label>
                    <Textarea 
                        id="rejection-reason"
                        placeholder="e.g., Missing documents, below minimum entry requirements..."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setRejectionDialog(null)}>Cancel</Button>
                <Button 
                    variant="destructive" 
                    disabled={!rejectionReason.trim() || isProcessing}
                    onClick={() => rejectionDialog && handleStatusUpdate(rejectionDialog.university, rejectionDialog.major, 'Rejected', rejectionReason.trim())}
                >
                    {isProcessing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Confirm Rejection
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Status Dialog */}
      <Dialog open={!!bulkStatusDialog} onOpenChange={(open) => !open && setBulkStatusDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Status Update</DialogTitle>
            <DialogDescription>
              Set <strong>{selectedApps.size}</strong> applications to <strong>{bulkStatusDialog?.toUpperCase()}</strong>.
            </DialogDescription>
          </DialogHeader>
          {bulkStatusDialog === 'Rejected' && (
            <div className="space-y-2 py-4">
              <Label>Common Rejection Reason</Label>
              <Textarea 
                placeholder="Reason for all selected rejections..."
                value={bulkRejectionReason}
                onChange={(e) => setBulkRejectionReason(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkStatusDialog(null)}>Cancel</Button>
            <Button 
              onClick={handleBulkStatusUpdate} 
              disabled={isProcessing || (bulkStatusDialog === 'Rejected' && !bulkRejectionReason.trim())}
            >
              {isProcessing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Update {selectedApps.size} Applications
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
