
'use client';

import { useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';

export default function StudentAddedPage() {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const studentName = searchParams.get('studentName');

  if (!returnTo || !studentName) {
    return (
        <div className="flex items-center justify-center h-full">
            <Card className="w-full max-w-md text-center">
                <CardHeader className="items-center">
                    <CardTitle>Invalid Page</CardTitle>
                    <CardDescription>
                        This page was accessed with incomplete information. Please return to the dashboard.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                <Button asChild className="w-full">
                    <a href="/dashboard">Return to Dashboard</a>
                </Button>
                </CardContent>
            </Card>
        </div>
    );
  }
  
  return (
    <div className="flex items-center justify-center h-full">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mx-auto bg-green-100 dark:bg-green-900/50 rounded-full p-3 w-fit">
            <CheckCircle className="h-10 w-10 text-green-500" />
          </div>
          <CardTitle className="mt-4">Student Added Successfully!</CardTitle>
          <CardDescription>
            The profile for <span className="font-semibold">{studentName}</span> has been created.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={returnTo}>
              Return to {returnTo.includes('unassigned') ? 'Unassigned Students' : 'Applicants'}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
