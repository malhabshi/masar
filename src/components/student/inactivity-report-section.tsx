
'use client';

import { useState, useMemo } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, Send } from 'lucide-react';
import { submitInactivityReport } from '@/lib/actions';
import { subDays } from 'date-fns';
import { toDate } from '@/lib/timestamp-utils';

interface InactivityReportSectionProps {
  student: Student;
  currentUser: AppUser;
}

export function InactivityReportSection({ student, currentUser }: InactivityReportSectionProps) {
  const [report, setReport] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const isAssignedEmployee = currentUser.civilId === student.employeeId;
  
  const isStagnant = useMemo(() => {
    // 1. Exclude high-priority or finalized students
    if (student.changeAgentRequired || student.profileCompletionStatus?.readyToTravel) {
      return false;
    }

    // 2. Check for 10 days of inactivity
    // Use lastActivityAt, fallback to createdAt
    const lastActivity = toDate(student.lastActivityAt || student.createdAt);
    if (!lastActivity) return false;

    const tenDaysAgo = subDays(new Date(), 10);
    return lastActivity < tenDaysAgo;
  }, [student]);

  const handleSubmit = async () => {
    if (!report.trim()) return;

    setIsLoading(true);
    const result = await submitInactivityReport(student.id, currentUser.id, report.trim());

    if (result.success) {
      toast({
        title: 'Report Submitted',
        description: 'The inactivity alert has been cleared and your report was sent to management.',
      });
      setReport('');
    } else {
      toast({
        variant: 'destructive',
        title: 'Submission Failed',
        description: result.message,
      });
    }
    setIsLoading(false);
  };

  if (!isStagnant || !isAssignedEmployee) return null;

  return (
    <Card className="border-orange-500 bg-orange-50 shadow-lg animate-in fade-in slide-in-from-top-4 duration-500">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2 text-orange-700">
          <AlertCircle className="h-5 w-5 animate-pulse" />
          <CardTitle className="text-lg">Inactivity Alert: Give a report on the student after you contact him</CardTitle>
        </div>
        <CardDescription className="text-orange-600 font-medium">
          There has been no activity on this profile for over 10 days. Management requires an status update.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea 
          placeholder="Type your report here... (e.g., I called the student today and he said he is waiting for his transcript...)"
          className="bg-white border-orange-200 focus-visible:ring-orange-500"
          value={report}
          onChange={(e) => setReport(e.target.value)}
          disabled={isLoading}
        />
        <div className="flex justify-end">
          <Button 
            onClick={handleSubmit} 
            disabled={isLoading || !report.trim()}
            className="bg-orange-600 hover:bg-orange-700 text-white font-bold gap-2"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit Report to Admins
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
