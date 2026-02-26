'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { Student, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import { resolveDuplicate } from '@/lib/actions';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { where, documentId } from 'firebase/firestore';

interface DuplicateWarningBannerProps {
  student: Student;
  currentUser: AppUser;
}

export function DuplicateWarningBanner({ student, currentUser }: DuplicateWarningBannerProps) {
  const { toast } = useToast();
  const [isResolving, setIsResolving] = useState(false);

  // Fetch all duplicate student profiles
  const duplicateIds = student.duplicateOfStudentIds || [];
  
  const duplicateQuery = useMemoFirebase(() => {
    if (duplicateIds.length === 0) return null;
    // Chunk IDs for Firestore 'in' query (limit 30)
    return [where(documentId(), 'in', duplicateIds.slice(0, 30))];
  }, [duplicateIds]);

  const { data: otherStudents, isLoading: studentsLoading } = useCollection<Student>(
    duplicateQuery ? 'students' : '',
    ...(duplicateQuery || [])
  );

  // Fetch unique employee IDs assigned to those duplicates
  const employeeCivilIds = useMemo(() => {
    if (!otherStudents) return [];
    const ids = otherStudents.map(s => s.employeeId).filter((id): id is string => !!id);
    return [...new Set(ids)];
  }, [otherStudents]);

  const { userMap: employeeMap, isLoading: employeesLoading } = useUserCacheByCivilId(employeeCivilIds);

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

  if (!student.duplicatePhoneWarning || duplicateIds.length === 0) return null;

  const isAdmin = currentUser.role === 'admin';
  const isLoading = studentsLoading || (employeeCivilIds.length > 0 && employeesLoading);

  if (isLoading) {
    return (
      <Alert className="border-red-200 bg-red-50/50">
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>Checking for duplicate student records...</AlertDescription>
      </Alert>
    );
  }

  const conflicts = (otherStudents || []).map(other => {
    const employee = other.employeeId ? employeeMap.get(other.employeeId) : null;
    return {
      id: other.id,
      name: other.name,
      employeeName: employee?.name || 'Unassigned'
    };
  });

  return (
    <Alert variant="destructive" className="border-red-500 bg-red-50/50">
      <AlertTriangle className="h-4 w-4" />
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
        <div className="flex-1">
          <AlertTitle className="text-red-800 font-bold">Duplicate Phone Number Detected</AlertTitle>
          <AlertDescription className="text-red-700 mt-1">
            {conflicts.length === 1 ? (
              <>
                ⚠️ We found a duplicate student with the same phone number <strong>{conflicts[0].name}</strong>, he is assigned to <strong>{conflicts[0].employeeName}</strong>.
                <Link href={`/student/${conflicts[0].id}`} className="ml-2 underline text-xs">View Profile</Link>
              </>
            ) : (
              <>
                ⚠️ We found duplicate students with the same phone number: {conflicts.map((c, i) => (
                  <span key={c.id}>
                    <strong>{c.name}</strong> (assigned to <strong>{c.employeeName}</strong>)
                    {i < conflicts.length - 1 ? ', ' : ''}
                    <Link href={`/student/${c.id}`} className="ml-1 mr-2 underline text-xs">View</Link>
                  </span>
                ))}
              </>
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
            Resolve Warning
          </Button>
        )}
      </div>
    </Alert>
  );
}
