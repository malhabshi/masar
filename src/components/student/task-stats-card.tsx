'use client';

import { useMemo } from 'react';
import type { Task } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface TaskStatsCardProps {
  tasks: Task[];
}

export function TaskStatsCard({ tasks }: TaskStatsCardProps) {
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    
    // Only count formal requests, not system updates or dashboard-sent feed items
    tasks.filter(t => t.category === 'request').forEach(task => {
      const type = task.taskType || 'General Request';
      counts[type] = (counts[type] || 0) + 1;
    });

    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [tasks]);

  if (stats.length === 0) return null;

  return (
    <Card>
      <CardHeader className="py-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Request Summary</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stats.map(([type, count]) => (
            <div key={type} className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-transparent hover:border-border transition-colors">
              <span className="text-sm font-medium text-muted-foreground truncate mr-2" title={type}>
                {type}
              </span>
              <Badge variant="secondary" className="font-mono h-6 w-6 flex items-center justify-center p-0 rounded-full">
                {count}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
