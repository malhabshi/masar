
'use client';

import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export default function EmployeeActivityPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee Activity</CardTitle>
        <CardDescription>
          A log of clock-in and clock-out times for all employees.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground bg-muted/50 rounded-lg">
            <Construction className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-semibold">Feature Under Construction</h3>
            <p className="text-sm">The time tracking and reporting feature is not yet fully implemented.</p>
        </div>
      </CardContent>
    </Card>
  );
}
