'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { where } from 'firebase/firestore';

interface DuplicateWarningBannerProps {
  student: Student;
  currentUser: AppUser;
}

export function DuplicateWarningBanner({ student, currentUser }: DuplicateWarningBannerProps) {
  // Perform a dynamic real-time query for any other student with the same phone number
  const samePhoneQuery = useMemoFirebase(() => {
    if (!student.phone) return [];
    return [where('phone', '==', student.phone)];
  }, [student.phone]);

  const { data: matches, isLoading: studentsLoading } = useCollection<Student>(
    student.phone ? 'students' : '',
    ...(samePhoneQuery || [])
  );

  // Filter out the current student from the results
  const duplicates = useMemo(() => {
    return (matches || []).filter(s => s.id !== student.id);
  }, [matches, student.id]);

  // Fetch unique employee IDs assigned to those duplicates for context
  const employeeCivilIds = useMemo(() => {
    const ids = duplicates.map(s => s.employeeId).filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [duplicates]);

  const { userMap: employeeMap, isLoading: employeesLoading } = useUserCacheByCivilId(employeeCivilIds);

  const isLoading = studentsLoading || (employeeCivilIds.length > 0 && employeesLoading);

  if (isLoading) {
    return (
      <Alert className="border-red-200 bg-red-50/50">
        <Loader2 className="h-4 w-4 animate-spin text-red-600" />
        <AlertDescription className="text-red-700 italic">Checking for duplicate phone records...</AlertDescription>
      </Alert>
    );
  }

  if (duplicates.length === 0) return null;

  const conflicts = duplicates.map(other => {
    const employee = other.employeeId ? employeeMap.get(other.employeeId) : null;
    return {
      id: other.id,
      name: other.name,
      employeeName: employee?.name || 'Unassigned'
    };
  });

  return (
    <Alert variant="destructive" className="border-red-500 bg-red-50/50 shadow-sm border-2 animate-in fade-in slide-in-from-top-2">
      <AlertTriangle className="h-5 w-5" />
      <div className="flex flex-col gap-2 w-full">
        <div>
          <AlertTitle className="text-red-800 font-black uppercase tracking-tight">Duplicate Phone Number Detected</AlertTitle>
          <AlertDescription className="text-red-700 mt-1 font-medium">
            {conflicts.length === 1 ? (
              <>
                ⚠️ Another student profile uses the same phone number: <strong>{conflicts[0].name}</strong>. 
                They are currently assigned to <strong>{conflicts[0].employeeName}</strong>.
                <Link href={`/student/${conflicts[0].id}`} className="ml-2 underline font-bold hover:text-red-900">View Duplicate Profile →</Link>
              </>
            ) : (
              <>
                ⚠️ Multiple student profiles found with this phone number:
                <div className="mt-2 space-y-1">
                  {conflicts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="text-xs">
                        <strong>{c.name}</strong> (Agent: <strong>{c.employeeName}</strong>)
                        <Link href={`/student/${c.id}`} className="ml-2 underline font-bold">Open View</Link>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </AlertDescription>
        </div>
        
        <p className="text-[10px] text-red-600 font-bold italic border-t border-red-200 pt-2 mt-1">
          This warning is permanent while the data remains duplicated. Please merge profiles or update the phone number to clear this alert.
        </p>
      </div>
    </Alert>
  );
}
