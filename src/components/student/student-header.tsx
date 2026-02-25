
'use client';

import { useMemo } from 'react';
import type { Student, Country, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Phone, Mail, GraduationCap, ArrowRightLeft, ShieldAlert } from 'lucide-react';
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


interface StudentHeaderProps {
  student: Student | null; // Allow null for loading state
  currentUser: AppUser | null; // Allow null for loading state
  isLoading?: boolean;
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

  const targetCountriesFromProps = student.targetCountries || [];
  const applicationCountries = student.applications?.map(app => app.country) || [];
  const allCountries = [...new Set([...targetCountriesFromProps, ...applicationCountries])];

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
            <h1 className="text-3xl font-bold">{student.name || 'Unknown Student'}</h1>
            {student.term && <BadgeComponent variant="secondary" className="text-base">{student.term}</BadgeComponent>}
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
            {canRequestTransfer && <RequestTransferDialog student={student} currentUser={currentUser} />}
            {canRequestDeletion && <RequestDeletionDialog student={student} currentUser={currentUser} />}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
