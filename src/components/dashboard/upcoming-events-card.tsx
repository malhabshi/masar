'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCollection } from '@/firebase/client';
import { CalendarDays } from 'lucide-react';
import { formatDate, sortByDate } from '@/lib/timestamp-utils';
import type { UpcomingEvent, User } from '@/lib/types';

interface UpcomingEventsCardProps {
  currentUser: User;
}


export function UpcomingEventsCard({currentUser}: UpcomingEventsCardProps) {
  const { data: events, isLoading } = useCollection<UpcomingEvent>('upcoming_events');
  
  const sortedEvents = useMemo(() => {
    if (!events) return [];
    return [...events].sort((a, b) => sortByDate(a,b, 'date', 'asc')).slice(0, 5);
  }, [events]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upcoming Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
            <div className="h-4 w-full bg-muted animate-pulse rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Events</CardTitle>
      </CardHeader>
      <CardContent>
        {sortedEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <div className="space-y-3">
            {sortedEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-3">
                <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(event.date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
