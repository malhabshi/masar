'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Student, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useDoc } from '@/firebase/client';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { resolveDuplicate } from '@/lib/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface DuplicateWarningBannerProps {
  student: Student;
  currentUser: AppUser;
}

export function DuplicateWarningBanner({ student, currentUser }: DuplicateWarningBannerProps) {
  const { toast } = useToast();
  const [isResolving, setIsResolving] = useState(false);

  // Fetch the student document that this one is a duplicate of
  const { data: otherStudent, isLoading: otherStudentLoading } = useDoc<Student>(
    student.duplicateOfStudentId ? 'students' : '',
    student.duplicateOfStudentId || ''
  );

  // Fetch the employee assigned to that other student
  const { userMap: employeeMap, isLoading: employeeLoading } = useUserCacheByCivilId(
    otherStudent?.employeeId ? [otherStudent.employeeId] : []
  );

  const handleResolve = async () => {
    setIsResolving(true);
    const result = await resolveDuplicate(student.id, currentUser.id);
    if (result.success) {
      toast({ title: 'Warning Resolved', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Action Failed', description: result.message });
    }
    setIsResolving(false);
  };

  if (!student.duplicatePhoneWarning || !student.duplicateOfStudentId) return null;

  const isAdmin = currentUser.role === 'admin';
  const otherEmployee = otherStudent?.employeeId ? employeeMap.get(otherStudent.employeeId) : null;

  return (
    <Alert variant="destructive" className="border-red-500 bg-red-50/50">
      <AlertTriangle className="h-4 w-4" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
        <div>
          <AlertTitle className="text-red-800">Duplicate Phone Number Detected</AlertTitle>
          <AlertDescription className="text-red-700">
            This phone number ({student.phone}) is also used by{' '}
            {otherStudentLoading ? (
              '...'
            ) : (
              <Link href={`/student/${otherStudent?.id}`} className="font-bold underline hover:no-underline">
                {otherStudent?.name || 'another student'}
              </Link>
            )}
            {otherStudent && (
              <> (assigned to {employeeLoading ? '...' : (otherEmployee?.name || 'Unassigned')})</>
            )}
          </AlertDescription>
        </div>
        
        {isAdmin && (
          <Button 
            variant="outline" 
            size="sm" 
            className="border-red-200 text-red-800 hover:bg-red-100 shrink-0"
            onClick={handleResolve}
            disabled={isResolving}
          >
            {isResolving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-2 h-4 w-4" />
            )}
            Resolve Duplicate Warning
          </Button>
        )}
      </div>
    </Alert>
  );
}
