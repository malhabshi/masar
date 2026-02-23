

'use client';

import type { Student, Country } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Phone, Mail, GraduationCap, ArrowRightLeft } from 'lucide-react';
import { Badge as BadgeComponent } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WhatsAppIcon } from '@/components/icons/whatsapp-icon';
import { EditStudentDialog } from './edit-student-dialog';
import { Skeleton } from '../ui/skeleton';
import { FinalizeStudentDialog } from './finalize-student-dialog';
import { RequestTransferDialog } from './request-transfer-dialog';
import { TransferStudentDialog } from './transfer-student-dialog';
import { useUsers } from '@/contexts/users-provider';
import { DeleteStudentDialog } from './delete-student-dialog';


interface StudentHeaderProps {
  student: Student | null; // Allow null for loading state
  currentUser: AppUser | null; // Allow null for loading state
  isLoading?: boolean;
}

function StudentHeaderSkeleton() {
    return (
        <div className="mb-6">
            <div className="flex flex-col md:flex-row items-start gap-6">
                <Skeleton className="w-24 h-24 rounded-full" />
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
  const { users, usersLoading } = useUsers();

  if (isLoading || !student || !currentUser || usersLoading) {
    return <StudentHeaderSkeleton />;
  }

  const cleanPhoneNumber = (student.phone || '').replace(/\D/g, '');
  const whatsappLink = `https://wa.me/965${cleanPhoneNumber}`; // Assuming Kuwait country code
  
  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  const canManage = ['admin', 'department'].includes(currentUser.role);
  const isAdmin = currentUser.role === 'admin';
  const canEdit = canManage || isAssignedEmployee;

  const canRequestTransfer = isAssignedEmployee && !student.transferRequested;
  const canApproveTransfer = canManage && student.transferRequested;
  const canFinalize = canManage && !student.finalChoiceUniversity;
  const employeeUsers = users.filter(u => u.role === 'employee');

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
      <div className="flex flex-col md:flex-row items-start gap-6">
        <Avatar className="w-24 h-24 border-4 border-card">
          <AvatarImage src={student.avatarUrl} alt={student.name} data-ai-hint="student avatar" />
          <AvatarFallback className="text-3xl">{student?.name?.charAt(0) ?? 'S'}</AvatarFallback>
        </Avatar>
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
            {canEdit && <EditStudentDialog student={student} />}
            {canRequestTransfer && <RequestTransferDialog student={student} currentUser={currentUser} />}
            {canApproveTransfer && <TransferStudentDialog student={student} employees={employeeUsers} currentUser={currentUser} />}
            {canFinalize && <FinalizeStudentDialog student={student} currentUser={currentUser} />}
            {isAdmin && <DeleteStudentDialog studentId={student.id} studentName={student.name} currentUser={currentUser} />}
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
              <Button asChild variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-600">
                <a href={whatsappLink} target="_blank" rel="noopener noreferrer" title="Chat on WhatsApp">
                  <WhatsAppIcon className="h-5 w-5" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
