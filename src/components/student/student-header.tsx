'use client';

import { useMemo, useState, useEffect } from 'react';
import type { Student, Country, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Phone, Mail, GraduationCap, ArrowRightLeft, ShieldAlert, ClipboardList, Calendar, UserRoundX, Loader2, FlaskConical, FileDown, X, CheckCircle } from 'lucide-react';
import { Badge as BadgeComponent } from '@/components/ui/badge';
import { EditStudentDialog } from './edit-student-dialog';
import { Skeleton } from '../ui/skeleton';
import { RequestTransferDialog } from './request-transfer-dialog';
import { TransferStudentDialog } from './transfer-student-dialog';
import { DeleteStudentDialog } from './delete-student-dialog';
import { useCollection } from '@/firebase/client';
import { RequestDeletionDialog } from './request-deletion-dialog';
import { ApproveDeletionDialog } from './approve-deletion-dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import { CreateStudentTaskDialog } from '../tasks/create-student-task-dialog';
import { Button } from '@/components/ui/button';
import { toggleChangeAgentStatus, forceInactivity, clearStudentFlagsForEveryone } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';


interface StudentHeaderProps {
  student: Student | null; // Allow null for loading state
  currentUser: AppUser | null; // Allow null for loading state
  isLoading?: boolean;
}

function WhatsAppIcon(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="currentColor"
        {...props}
      >
        <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.487 5.235 3.487 8.413.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01s-.52.074-.792.372c-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
      </svg>
    );
}

function StudentHeaderSkeleton() {
    return (
        <div className="mb-6">
            <div className="flex flex-col items-start gap-2">
                <div className="flex-1 space-y-2">
                    <Skeleton className="h-8 w-64" />
                    <Skeleton className="h-5 w-48" />
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-2">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-5 w-32" />
                    </div>
                </div>
            </div>
        </div>
    )
}

function ChangeAgentDialog({ 
  student, 
  onConfirm, 
  isOpen, 
  onOpenChange, 
  isLoading 
}: { 
  student: Student; 
  onConfirm: (universities: string[]) => void; 
  isOpen: boolean; 
  onOpenChange: (open: boolean) => void;
  isLoading: boolean;
}) {
  const [selectedUnis, setSelectedUnis] = useState<string[]>([]);

  const studentUnis = useMemo(() => {
    return Array.from(new Set((student.applications || []).map(a => a.university)));
  }, [student.applications]);

  useEffect(() => {
    if (isOpen) {
      setSelectedUnis(student.changeAgentUniversities || []);
    }
  }, [isOpen, student.changeAgentUniversities]);

  const handleToggle = (uni: string) => {
    setSelectedUnis(prev => prev.includes(uni) ? prev.filter(u => u !== uni) : [...prev, uni]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{student.changeAgentRequired ? 'Manage Change Agent' : 'Enable Change Agent Status'}</DialogTitle>
          <DialogDescription>
            {student.changeAgentRequired 
              ? 'Update the flagged universities or resolve the problem to clear this urgent alert.'
              : 'Select the existing university applications that require urgent attention from management.'}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Available Applications</Label>
            <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2">
              {studentUnis.length > 0 ? studentUnis.map(uni => {
                const app = student.applications?.find(a => a.university === uni);
                return (
                  <div key={uni} className="flex items-center space-x-3 p-3 rounded-lg border bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer" onClick={() => handleToggle(uni)}>
                    <Checkbox 
                      id={`uni-${uni}`} 
                      checked={selectedUnis.includes(uni)} 
                      onCheckedChange={() => handleToggle(uni)}
                      onClick={(e) => e.stopPropagation()} 
                    />
                    <div className="flex-1">
                      <Label htmlFor={`uni-${uni}`} className="text-sm font-bold cursor-pointer">{uni}</Label>
                      {app && <span className="block text-[10px] text-muted-foreground uppercase font-mono">{app.country} • {app.status}</span>}
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-10 border rounded-lg border-dashed bg-red-50 text-red-600">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-xs font-bold">No Applications Found</p>
                  <p className="text-[10px] mt-1">Please add a university application to the profile before enabling Change Agent status.</p>
                </div>
              )}
            </div>
          </div>

          {selectedUnis.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2 border-t mt-4">
              <p className="text-[10px] font-bold uppercase text-muted-foreground w-full mb-1">Flagged for attention:</p>
              {selectedUnis.map(uni => (
                <BadgeComponent key={uni} variant="secondary" className="gap-1 px-2 py-1 bg-red-50 text-red-700 border-red-200">
                  {uni}
                  <X className="h-3 w-3 cursor-pointer" onClick={(e) => { e.stopPropagation(); handleToggle(uni); }} />
                </BadgeComponent>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2">
          {student.changeAgentRequired && (
            <Button 
              variant="outline" 
              className="w-full sm:w-auto border-green-600 text-green-700 hover:bg-green-50 font-bold gap-2"
              onClick={() => onConfirm([])}
              disabled={isLoading}
            >
              <CheckCircle className="h-4 w-4" />
              Resolve Problem & Clear Alert
            </Button>
          )}
          <div className="flex-1" />
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button 
            disabled={selectedUnis.length === 0 || isLoading} 
            onClick={() => onConfirm(selectedUnis)}
            className="bg-red-600 hover:bg-red-700 text-white font-bold"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {student.changeAgentRequired ? 'Update List' : 'Enable Status'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StudentHeader({ student, currentUser, isLoading }: StudentHeaderProps) {
  const { toast } = useToast();
  const [isTogglingAgent, setIsTogglingAgent] = useState(false);
  const [isChangeAgentDialogOpen, setIsChangeAgentDialogOpen] = useState(false);
  const [isForcingInactivity, setIsForcingInactivity] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [isClearingFlags, setIsClearingFlags] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const { data: users, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');

  useEffect(() => {
    setIsClient(true);
  }, []);

  const requesterId = student?.deletionRequested?.requestedBy;
  const transferRequesterId = student?.transferRequest?.requestedBy;
  
  const { userMap } = useUserCacheById([
    ...(requesterId ? [requesterId] : []),
    ...(transferRequesterId ? [transferRequesterId] : [])
  ]);

  const requester = requesterId ? userMap.get(requesterId) : null;
  const transferRequester = transferRequesterId ? userMap.get(transferRequesterId) : null;

  if (isLoading || !student || !currentUser || usersLoading) {
    return <StudentHeaderSkeleton />;
  }
  
  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  const canManage = ['admin', 'department'].includes(currentUser.role);
  const isAdmin = currentUser.role === 'admin';
  const canEdit = canManage || isAssignedEmployee;

  const canRequestTransfer = isAssignedEmployee && !student.transferRequested;
  const canRequestDeletion = isAssignedEmployee && !student.deletionRequested;
  const canAssign = canManage && !student.employeeId;
  const canApproveTransfer = canManage && student.transferRequested;
  const canApproveDeletion = isAdmin && student.deletionRequested?.status === 'pending';
  
  // Inclusive filter: Any staff member with a Civil ID can be assigned students
  const staffOptions = (users || []).filter(u => u.civilId && (u.role === 'employee' || u.role === 'admin' || u.role === 'department'));

  const countryEmojis: Record<Country, string> = {
    UK: '🇬🇧',
    USA: '🇺🇸',
    Australia: '🇦🇺',
    'New Zealand': '🇳🇿',
  };

  const handleToggleChangeAgent = async (universities?: string[]) => {
    if (!canManage) return;
    setIsTogglingAgent(true);
    
    // If universities is empty, we are disabling the status.
    const isTurningOff = !universities || universities.length === 0;
    const newVal = !isTurningOff;
    
    const result = await toggleChangeAgentStatus(student.id, newVal, currentUser.id, universities);
    if (result.success) {
      toast({ title: result.message });
      setIsChangeAgentDialogOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsTogglingAgent(false);
  };

  const handleClearFlags = async () => {
    if (!canManage) return;
    setIsClearingFlags(true);
    const result = await clearStudentFlagsForEveryone(student!.id, currentUser!.id);
    if (result.success) {
      toast({ title: 'Flags Cleared', description: 'All notification flags have been cleared for everyone.' });
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsClearingFlags(false);
  };

  const handleForceInactivity = async () => {
    if (!isAdmin) return;
    setIsForcingInactivity(true);
    const result = await forceInactivity(student.id);
    if (result.success) {
      toast({ title: 'Simulating 11 days of inactivity...' });
      setTimeout(() => window.location.reload(), 1000);
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsForcingInactivity(false);
  };

  const handleDownloadPDF = async () => {
    setIsGeneratingPDF(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');
      
      const element = document.getElementById('student-profile-content');
      if (!element) return;

      // Hide interactive elements during capture
      const actionsToHide = element.querySelectorAll('.pdf-hide');
      actionsToHide.forEach(el => (el as HTMLElement).style.display = 'none');

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      // Show elements back
      actionsToHide.forEach(el => (el as HTMLElement).style.display = '');

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${student.name.replace(/\s+/g, '_')}_Profile.pdf`);
      
      toast({ title: 'PDF Ready', description: 'The profile document has been generated.' });
    } catch (error) {
      console.error('PDF Error:', error);
      toast({ variant: 'destructive', title: 'Download Failed', description: 'Could not generate the profile PDF.' });
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  const allCountries = [...new Set(student.applications?.map(app => app.country) || [])];

  const getUniCountry = (uniName: string) => {
    const app = student.applications?.find(a => a.university === uniName);
    return app?.country;
  };

  return (
    <div className="mb-6 relative" id="student-header">
      <div className="absolute top-0 right-0 flex flex-col items-end gap-3 z-10">
        {allCountries.length > 0 && (
          <div className="flex gap-2" title={allCountries.join(', ')}>
              {allCountries.map(country => (
                  countryEmojis[country as Country] ? (
                    <div key={country} className="text-4xl drop-shadow-sm">
                        {countryEmojis[country as Country]}
                    </div>
                  ) : null
              ))}
          </div>
        )}
        {student.changeAgentRequired && student.changeAgentUniversities && student.changeAgentUniversities.length > 0 && (
          <div className="flex flex-col items-end gap-1.5 max-w-[300px] animate-in fade-in slide-in-from-right-4">
            <p className="text-[9px] font-black text-red-600 uppercase tracking-widest bg-white/90 px-1.5 py-0.5 rounded shadow-sm border border-red-100">
              Change Agent Required For:
            </p>
            <div className="flex flex-wrap justify-end gap-1">
              {student.changeAgentUniversities.map((uni, idx) => {
                const country = getUniCountry(uni);
                return (
                  <BadgeComponent 
                    key={idx} 
                    className="bg-red-600 text-white font-black text-[9px] py-0.5 px-2 uppercase shadow-sm border-white/20 whitespace-normal text-right leading-none h-auto"
                  >
                    {uni} {country ? `(${country})` : ''}
                  </BadgeComponent>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col items-start gap-2">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold flex items-center gap-3">
              {student.internalNumber && (
                <span className="text-primary opacity-50 font-mono tracking-tighter">
                  #{student.internalNumber}
                </span>
              )}
              {student.name || 'Unknown Student'}
            </h1>
            
            {student.changeAgentRequired && (
              <BadgeComponent className="bg-black text-red-50 border-red-500 border-2 font-black animate-pulse text-sm px-3 py-1">
                CHANGE AGENT
              </BadgeComponent>
            )}

            {student.academicIntakeSemester && (
              <BadgeComponent variant="default" className="bg-primary text-primary-foreground flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold shadow-sm rounded-full">
                <Calendar className="h-4 w-4" />
                {student.academicIntakeSemester} {student.academicIntakeYear}
              </BadgeComponent>
            )}

            <div className="pdf-hide flex flex-wrap gap-2 items-center">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleDownloadPDF} 
                disabled={isGeneratingPDF}
                className="bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
              >
                {isGeneratingPDF ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
                Download PDF
              </Button>

              {canManage && (
                <Button 
                   variant="outline"
                   size="sm"
                   onClick={handleClearFlags}
                   disabled={isClearingFlags}
                   className="bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100 font-bold"
                >
                  {isClearingFlags ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
                  Clear Flags for All
                </Button>
              )}

              {student.transferRequested && (
                  <TooltipProvider>
                      <Tooltip>
                          <TooltipTrigger asChild>
                              <BadgeComponent variant="outline" className="border-yellow-500 text-yellow-600 text-base py-1 px-3 cursor-help">
                                  <ArrowRightLeft className="mr-2 h-4 w-4" />
                                  Transfer Requested
                              </BadgeComponent>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[300px] p-3 space-y-2">
                              <p className="font-bold text-xs uppercase text-yellow-600">Transfer Request Details:</p>
                              <p className="text-xs text-muted-foreground font-medium italic">
                                "{student.transferRequest?.reason || 'No reason provided.'}"
                              </p>
                              <div className="text-[10px] text-muted-foreground border-t pt-1.5 mt-1.5">
                                  By {transferRequester?.name || '...'} {isClient && student.transferRequest ? formatRelativeTime(student.transferRequest.requestedAt) : '...'}
                              </div>
                          </TooltipContent>
                      </Tooltip>
                  </TooltipProvider>
              )}
              {student.deletionRequested?.status === 'pending' && (
                  <TooltipProvider>
                      <Tooltip>
                      <TooltipTrigger>
                          <BadgeComponent variant="destructive" className="flex items-center gap-1 text-base py-1 px-3">
                              <ShieldAlert className="mr-1 h-4 w-4" />
                              Deletion Requested
                          </BadgeComponent>
                      </TooltipTrigger>
                      <TooltipContent>
                          <p>Requested by {requester?.name || '...'} {isClient ? formatRelativeTime(student.deletionRequested.requestedAt) : '...'}</p>
                      </TooltipContent>
                      </Tooltip>
                  </TooltipProvider>
              )}
              {canEdit && <EditStudentDialog student={student} />}
              
              {/* Restored "New Task" Button - Now restricted to assigned employee only per user request */}
              {isAssignedEmployee && (
                <CreateStudentTaskDialog student={student} currentUser={currentUser} />
              )}

              {canRequestTransfer && <RequestTransferDialog student={student} currentUser={currentUser} />}
              {canRequestDeletion && <RequestDeletionDialog student={student} currentUser={currentUser} />}
              
              {canManage && (
                <Button 
                  variant={student.changeAgentRequired ? "destructive" : "outline"}
                  size="sm"
                  onClick={() => setIsChangeAgentDialogOpen(true)}
                  disabled={isTogglingAgent}
                  className={student.changeAgentRequired ? "bg-black text-red-50 hover:bg-black/90" : ""}
                >
                  {isTogglingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundX className="mr-2 h-4 w-4" />}
                  {student.changeAgentRequired ? 'Manage Change Agent' : 'Change Agent'}
                </Button>
              )}

              {isAdmin && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={handleForceInactivity} 
                  disabled={isForcingInactivity}
                  className="opacity-20 hover:opacity-100 hover:bg-orange-100 hover:text-orange-700 h-8 gap-1 text-[10px] font-bold"
                >
                  {isForcingInactivity ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                  DEBUG: Force 10d Inactivity
                </Button>
              )}

              {canAssign && <TransferStudentDialog student={student} employees={staffOptions} currentUser={currentUser} actionType="assign" />}
              {canApproveTransfer && <TransferStudentDialog student={student} employees={staffOptions} currentUser={currentUser} actionType="transfer" />}

              {canApproveDeletion && <ApproveDeletionDialog student={student} currentUser={currentUser} />}
              {isAdmin && !canApproveDeletion && <DeleteStudentDialog studentId={student.id} studentName={student.name} currentUser={currentUser} />}
            </div>
          </div>
          {student.finalChoiceUniversity && (
            <div className="flex items-center gap-2 mt-2 text-lg font-semibold text-success">
              < GraduationCap className="h-5 w-5" />
              <span>{student.finalChoiceUniversity}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground mt-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4" />
              <span>{student.email || 'No Email'}</span>
            </div>
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              <span>{student.phone || 'No Phone'}</span>
              <div className="pdf-hide">
                {student.phone && (
                  <a
                    href={`https://wa.me/965${student.phone.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-green-500 hover:text-green-600"
                  >
                    <WhatsAppIcon className="h-5 w-5" />
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <ChangeAgentDialog 
        student={student} 
        isOpen={isChangeAgentDialogOpen} 
        onOpenChange={setIsChangeAgentDialogOpen} 
        onConfirm={(unis) => handleToggleChangeAgent(unis)}
        isLoading={isTogglingAgent}
      />
    </div>
  );
}