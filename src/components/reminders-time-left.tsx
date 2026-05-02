'use client';

import { useEffect, useState } from 'react';
import { isPast, formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

export function TimeLeft({ dueAt, className }: { dueAt: string; className?: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const due = new Date(dueAt);
  const overdue = isPast(due);
  return (
    <span className={cn('text-xs font-medium', overdue ? 'text-red-600' : 'text-emerald-600', className)}>
      {overdue ? `Overdue · ${formatDistanceToNow(due)} ago` : `In ${formatDistanceToNow(due)}`}
    </span>
  );
}
