'use client';

import { useMemo } from 'react';
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
  // All non-empty phones of the current student
  const phonesKey = [student.phone, student.phone2, student.phone3].filter(Boolean).join(',');
  const hasPhones = phonesKey.length > 0;

  // Query students where `phone` field matches any of the current student's phones
  const q1 = useMemoFirebase(() => {
    const phones = [student.phone, student.phone2, student.phone3].filter(Boolean) as string[];
    return phones.length ? [where('phone', 'in', phones)] : [];
  }, [phonesKey]);

  // Query students where `phone2` field matches any of the current student's phones
  const q2 = useMemoFirebase(() => {
    const phones = [student.phone, student.phone2, student.phone3].filter(Boolean) as string[];
    return phones.length ? [where('phone2', 'in', phones)] : [];
  }, [phonesKey]);

  // Query students where `phone3` field matches any of the current student's phones
  const q3 = useMemoFirebase(() => {
    const phones = [student.phone, student.phone2, student.phone3].filter(Boolean) as string[];
    return phones.length ? [where('phone3', 'in', phones)] : [];
  }, [phonesKey]);

  const { data: byPhone, isLoading: l1 } = useCollection<Student>(hasPhones ? 'students' : '', ...(q1 || []));
  const { data: byPhone2, isLoading: l2 } = useCollection<Student>(hasPhones ? 'students' : '', ...(q2 || []));
  const { data: byPhone3, isLoading: l3 } = useCollection<Student>(hasPhones ? 'students' : '', ...(q3 || []));

  // Merge results, deduplicate, exclude current student
  const duplicates = useMemo(() => {
    const seen = new Set<string>();
    const all = [...(byPhone || []), ...(byPhone2 || []), ...(byPhone3 || [])];
    return all.filter(s => {
      if (s.id === student.id || seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }, [byPhone, byPhone2, byPhone3, student.id]);

  const employeeCivilIds = useMemo(() => {
    const ids = duplicates.map(s => s.employeeId).filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [duplicates]);

  const { userMap: employeeMap, isLoading: employeesLoading } = useUserCacheByCivilId(employeeCivilIds);

  const isLoading = l1 || l2 || l3 || (employeeCivilIds.length > 0 && employeesLoading);

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
                ⚠️ Another student profile shares a phone number: <strong>{conflicts[0].name}</strong>.
                They are currently assigned to <strong>{conflicts[0].employeeName}</strong>.
              </>
            ) : (
              <>
                ⚠️ Multiple student profiles found with overlapping phone numbers:
                <div className="mt-2 space-y-1">
                  {conflicts.map((c) => (
                    <div key={c.id} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                      <span className="text-xs">
                        <strong>{c.name}</strong> (Agent: <strong>{c.employeeName}</strong>)
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
