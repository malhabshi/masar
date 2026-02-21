'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

function StudentAddedContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const studentName = searchParams.get('studentName') || 'Student';
  const returnTo = searchParams.get('returnTo') || '/applicants';

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="h-12 w-12 text-green-500" />
          </div>
          <CardTitle className="text-center">Student Added Successfully!</CardTitle>
          <CardDescription className="text-center">
            {studentName} has been added to the system.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button onClick={() => router.push(returnTo)}>
            Return to {returnTo === '/applicants' ? 'Applicants' : 'Unassigned Students'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function StudentAddedPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <StudentAddedContent />
    </Suspense>
  );
}
