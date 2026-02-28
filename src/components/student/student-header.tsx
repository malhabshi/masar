
'use client';

import { useMemo, useState } from 'react';
import type { Student, Country, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Phone, Mail, GraduationCap, ArrowRightLeft, ShieldAlert, ClipboardList, Calendar, UserRoundX, Loader2, FlaskConical } from 'lucide-react';
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
import { toggleChangeAgentStatus, forceInactivity } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';


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

export function StudentHeader({ student, currentUser, isLoading }: StudentHeaderProps) {
  const { toast } = useToast();
  const [isTogglingAgent, setIsTogglingAgent] = useState(false);
  const [isForcingInactivity, setIsForcingInactivity] = useState(false);
  const { data: users, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');

  const requesterId = student?.deletionRequested?.requestedBy;
  const { userMap } = useUserCacheById(requesterId ? [requesterId] : []);
  const requester = requesterId ? userMap.get(requesterId) : null;

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
  
  const employeeUsers = (users || []).filter(u => u.role === 'employee');

  const countryEmojis: Record<Country, string> = {
    UK: '🇬🇧',
    USA: '🇺🇸',
    Australia: '🇦🇺',
    'New Zealand': '🇳🇿',
  };

  const handleToggleChangeAgent = async () => {
    if (!canManage) return;
    setIsTogglingAgent(true);
    const newVal = !student.changeAgentRequired;
    const result = await toggleChangeAgentStatus(student.id, newVal, currentUser.id);
    if (result.success) {
      toast({ title: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsTogglingAgent(false);
  };

  const handleForceInactivity = async () => {
    if (!isAdmin) return;
    setIsForcingInactivity(true);
    const result = await forceInactivity(student.id);
    if (result.success) {
      toast({ title: 'Simulating 11 days of inactivity...' });
      // Reload to trigger logic checks
      setTimeout(() => window.location.reload(), 1000);
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsForcingInactivity(false);
  };

  // Only use countries from active applications for the header flags
  const allCountries = [...new Set(student.applications?.map(app => app.country) || [])];

  return (
    <div className="mb-6 relative">
      {allCountries.length > 0 && (
        <div className="absolute top-0 right-0 flex gap-2" title={allCountries.join(', ')}>
            {allCountries.map(country => (
                countryEmojis[country] ? (
                  <div key={country} className="text-4xl">
                      {countryEmojis[country]}
                  </div>
                ) : null
            ))}
        </div>
      )}
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
            
            {/* Change Agent Badge */}
            {student.changeAgentRequired && (
              <BadgeComponent className="bg-black text-red-500 border-red-500 border-2 font-black animate-pulse text-sm px-3 py-1">
                CHANGE AGENT
              </BadgeComponent>
            )}

            {/* Academic Intake Badge next to name (Visible to all if set) */}
            {student.academicIntakeSemester && (
              <BadgeComponent variant="default" className="bg-primary text-primary-foreground flex items-center gap-1.5 px-4 py-1.5 text-sm font-bold shadow-sm rounded-full">
                <Calendar className="h-4 w-4" />
                {student.academicIntakeSemester} {student.academicIntakeYear}
              </BadgeComponent>
            )}

            {student.transferRequested && !canApproveTransfer && (
                <BadgeComponent variant="outline" className="border-yellow-500 text-yellow-600 text-base py-1 px-3">
                    <ArrowRightLeft className="mr-2 h-4 w-4" />
                    Transfer Requested
                </BadgeComponent>
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
                        <p>Requested by {requester?.name || '...'} {formatRelativeTime(student.deletionRequested.requestedAt)}</p>
                    </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            )}
            {canEdit && <EditStudentDialog student={student} />}
            {isAssignedEmployee && <CreateStudentTaskDialog student={student} currentUser={currentUser} />}
            {canRequestTransfer && <RequestTransferDialog student={student} currentUser={currentUser} />}
            {canRequestDeletion && <RequestDeletionDialog student={student} currentUser={currentUser} />}
            
            {canManage && (
              <Button 
                variant={student.changeAgentRequired ? "destructive" : "outline"}
                size="sm"
                onClick={handleToggleChangeAgent}
                disabled={isTogglingAgent}
                className={student.changeAgentRequired ? "bg-black text-red-500 hover:bg-black/90" : ""}
              >
                {isTogglingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundX className="mr-2 h-4 w-4" />}
                {student.changeAgentRequired ? 'Remove Change Agent' : 'Change Agent'}
              </Button>
            )}

            {/* DEBUG TOOLS */}
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

            {/* Explicitly separate Assign from Transfer Approve */}
            {canAssign && <TransferStudentDialog student={student} employees={employeeUsers} currentUser={currentUser} actionType="assign" />}
            {canApproveTransfer && <TransferStudentDialog student={student} employees={employeeUsers} currentUser={currentUser} actionType="transfer" />}

            {canApproveDeletion && <ApproveDeletionDialog student={student} currentUser={currentUser} />}
            {isAdmin && !canApproveDeletion && <DeleteStudentDialog studentId={student.id} studentName={student.name} currentUser={currentUser} />}
          </div>
          {student.finalChoiceUniversity && (
            <div className="flex items-center gap-2 mt-2 text-lg font-semibold text-success">
              <GraduationCap className="h-5 w-5" />
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
  );
}
