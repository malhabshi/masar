'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import Link from 'next/link';

function StudentAddedContent() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const studentName = searchParams.get('studentName');
    const returnTo = searchParams.get('returnTo') || '/applicants';

    return (
        <div className="flex min-h-screen items-center justify-center bg-background">
            <Card className="w-full max-w-md text-center">
                <CardHeader>
                    <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10 text-success">
                        <CheckCircle className="h-10 w-10" />
                    </div>
                    <CardTitle className="mt-4 text-2xl">Student Added!</CardTitle>
                    <CardDescription>
                        {studentName ? `A new profile for ${studentName} has been created.` : 'A new student profile has been created.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-muted-foreground">You can now view and manage their applications and documents from the applicants list.</p>
                </CardContent>
                <CardFooter className="flex justify-center gap-4">
                    <Button asChild variant="outline">
                        <Link href="/new-request">Add Another Student</Link>
                    </Button>
                    <Button asChild>
                        <Link href={returnTo}>Go to Applicants List</Link>
                    </Button>
                </CardFooter>
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
