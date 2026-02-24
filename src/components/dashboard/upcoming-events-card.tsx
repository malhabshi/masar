
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCollection } from '@/firebase/client';
import { CalendarDays, Loader2, Trash2, PlusCircle, Calendar as CalendarIcon } from 'lucide-react';
import { formatDate, sortByDate, toDate } from '@/lib/timestamp-utils';
import type { UpcomingEvent } from '@/lib/types';
import { useUser } from '@/hooks/use-user';
import { addEvent, deleteEvent } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { format as formatDateFns } from 'date-fns';

const eventSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters.'),
  description: z.string().optional(),
  date: z.date({ required_error: "An event date is required."}),
});

export function UpcomingEventsCard() {
  const { user, isUserLoading } = useUser();
  const { data: events, isLoading: areEventsLoading } = useCollection<UpcomingEvent>(user ? 'upcoming_events' : '');
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [newItems, setNewItems] = useState(new Set<string>());

  useEffect(() => {
    if (!events || events.length === 0 || !user) return;
    const storageKey = `lastViewedEvents_${user.id}`;
    const lastViewed = localStorage.getItem(storageKey);

    const newlyAdded = new Set<string>();
    events.forEach(event => {
      if (!lastViewed || new Date(event.date) > new Date(lastViewed)) {
        newlyAdded.add(event.id);
      }
    });

    if (newlyAdded.size > 0) {
      setNewItems(prev => new Set([...prev, ...newlyAdded]));
    }
    
    return () => {
      localStorage.setItem(storageKey, new Date().toISOString());
    };
  }, [events, user]);

  const form = useForm<z.infer<typeof eventSchema>>({
    resolver: zodResolver(eventSchema),
    defaultValues: { title: '', description: '' },
  });

  const isLoading = isUserLoading || areEventsLoading;
  const canManage = user?.role === 'admin' || user?.role === 'department';

  const futureEvents = useMemo(() => {
    if (!events) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return [...events]
      .filter(event => {
        const eventDate = toDate(event.date);
        return eventDate && eventDate >= today;
      })
      .sort((a, b) => sortByDate(a, b, 'date', 'asc'))
      .slice(0, 5);
  }, [events]);

  const handleAddEvent = async (values: z.infer<typeof eventSchema>) => {
    if (!user) return;
    setIsSubmitting(true);
    const result = await addEvent(user.id, values.title, values.description || '', values.date.toISOString());
    if (result.success) {
      toast({ title: 'Event Added', description: `"${values.title}" has been scheduled.` });
      form.reset();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    if (!user) return;
    const result = await deleteEvent(eventId, user.id);
    if (result.success) {
      toast({ title: 'Event Deleted' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming Events</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center items-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : futureEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No upcoming events.</p>
        ) : (
          <div className="space-y-3">
            {futureEvents.map((event) => (
              <div key={event.id} className={cn(
                  "flex items-start gap-3 group p-2 rounded-lg transition-colors duration-500",
                  newItems.has(event.id) && "bg-blue-500/10"
                )}>
                <CalendarDays className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div className="flex-1">
                  <p className="text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(event.date)}</p>
                </div>
                {canManage && (
                   <AlertDialog>
                      <AlertDialogTrigger asChild>
                         <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive">
                           <Trash2 className="h-4 w-4" />
                         </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                         <AlertDialogHeader>
                           <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                           <AlertDialogDescription>
                              This will permanently delete the event: "{event.title}".
                           </AlertDialogDescription>
                         </AlertDialogHeader>
                         <AlertDialogFooter>
                           <AlertDialogCancel>Cancel</AlertDialogCancel>
                           <AlertDialogAction onClick={() => handleDeleteEvent(event.id)}>Delete</AlertDialogAction>
                         </AlertDialogFooter>
                      </AlertDialogContent>
                   </AlertDialog>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
      {canManage && (
        <CardFooter className="border-t pt-4">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleAddEvent)} className="w-full space-y-4">
              <FormField
                control={form.control}
                name="title"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="sr-only">Title</FormLabel>
                    <FormControl>
                      <Input placeholder="Event Title" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                   <FormItem className="flex flex-col">
                     <FormLabel className="sr-only">Event Date</FormLabel>
                     <Popover>
                       <PopoverTrigger asChild>
                         <FormControl>
                           <Button
                             variant={"outline"}
                             className={cn(
                               "pl-3 text-left font-normal",
                               !field.value && "text-muted-foreground"
                             )}
                           >
                             {field.value ? (
                               formatDateFns(field.value, "PPP")
                             ) : (
                               <span>Pick a date</span>
                             )}
                             <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                           </Button>
                         </FormControl>
                       </PopoverTrigger>
                       <PopoverContent className="w-auto p-0" align="start">
                         <Calendar
                           mode="single"
                           selected={field.value}
                           onSelect={field.onChange}
                           disabled={(date) => date < new Date(new Date().setHours(0,0,0,0))}
                           initialFocus
                         />
                       </PopoverContent>
                     </Popover>
                     <FormMessage />
                   </FormItem>
                )}
              />
              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                Add Event
              </Button>
            </form>
          </Form>
        </CardFooter>
      )}
    </Card>
  );
}
