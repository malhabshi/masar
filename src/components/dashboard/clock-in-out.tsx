
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import type { TimeLog } from '@/lib/types';
import { clockIn, clockOut } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { differenceInHours, differenceInMinutes, differenceInSeconds } from 'date-fns';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, LogIn, LogOut } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';

export function ClockInOut() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [elapsedTime, setElapsedTime] = useState('00:00:00');

  const today = useMemo(() => new Date().toISOString().split('T')[0], []);

  const timeLogsQuery = useMemoFirebase(() => {
    if (!user) return [];
    return [
      where('employeeId', '==', user.id),
      where('clockOut', '==', null),
    ];
  }, [user]);

  const { data: activeLogsData, isLoading: logsAreLoading } = useCollection<TimeLog>(
    user ? 'time_logs' : '',
    ...timeLogsQuery
  );

  const activeLog = useMemo(() => {
    if (!activeLogsData || activeLogsData.length === 0) return null;
    return activeLogsData[0];
  }, [activeLogsData]);

  useEffect(() => {
    if (!activeLog) {
      setElapsedTime('00:00:00');
      return;
    }

    const interval = setInterval(() => {
      const now = new Date();
      const clockInTime = new Date(activeLog.clockIn);
      const seconds = differenceInSeconds(now, clockInTime) % 60;
      const minutes = differenceInMinutes(now, clockInTime) % 60;
      const hours = differenceInHours(now, clockInTime);

      setElapsedTime(
        `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      );
    }, 1000);

    return () => clearInterval(interval);
  }, [activeLog]);

  const handleClockIn = async () => {
    if (!user) return;
    setIsLoading(true);
    const result = await clockIn(user.id);
    if (result.success) {
      toast({ title: 'Clocked In', description: 'Your shift has started.' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  const handleClockOut = async () => {
    if (!user) return;
    setIsLoading(true);
    const result = await clockOut(user.id, notes);
    if (result.success) {
      toast({ title: 'Clocked Out', description: 'Your shift has ended.' });
      setNotes('');
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsLoading(false);
  };

  if (isUserLoading || logsAreLoading) {
    return (
      <Card className="p-4 mb-6">
        <Loader2 className="h-6 w-6 animate-spin mx-auto" />
      </Card>
    );
  }

  return (
    <Card className="mb-6">
      <CardContent className="p-4 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="font-semibold text-lg">{activeLog ? 'Clocked In' : 'Clocked Out'}</span>
          <span className="text-sm text-muted-foreground">
            {activeLog ? `Today's time: ${elapsedTime}` : 'Start your shift'}
          </span>
        </div>
        {activeLog ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
                Clock Out
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clock Out</AlertDialogTitle>
                <AlertDialogDescription>Add any notes for your shift before clocking out.</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes (Optional)</Label>
                <Textarea
                  id="notes"
                  placeholder="What did you work on?"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClockOut} disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Clock Out
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Button onClick={handleClockIn} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
            Clock In
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
