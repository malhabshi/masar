
'use client';

import { useState, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import type { User } from '@/lib/types';
import { Loader2, PlusCircle, Calendar as CalendarIcon, Trash2 } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
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
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { UpcomingEvent } from '@/lib/types';

const formSchema = z.object({
  title: z.string().min(3, { message: 'Title must be at least 3 characters.' }),
  description: z.string().min(10, { message: 'Description must be at least 10 characters.' }),
  date: z.date({ required_error: "A date is required." }),
});

interface UpcomingEventsCardProps {
  currentUser: User;
}

export function UpcomingEventsCard({ currentUser }: UpcomingEventsCardProps) {
  const { firestore } = useFirebase();
  const { toast } = useToast();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isClient, setIsClient] = useState(false);

  const eventsCollection = useMemoFirebase(() => {
    if (!firestore) return null;
    return collection(firestore, 'upcoming_events');
  }, [firestore]);

  const { data: events, isLoading: areEventsLoading } = useCollection<UpcomingEvent>(eventsCollection);

  useEffect(() => {
    setIsClient(true);
  }, []);
  
  const isAdmin = currentUser.role === 'admin';

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      description: '',
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!currentUser || !eventsCollection) return;
    setIsLoading(true);

    const newEventData = {
        title: values.title,
        description: values.description,
        date: values.date.toISOString(),
        authorId: currentUser.id,
    };

    addDocumentNonBlocking(eventsCollection, newEventData);

    toast({
      title: 'Event Added!',
      description: `${values.title} has been added to upcoming events.`,
    });
    
    form.reset();
    setIsDialogOpen(false);
    setIsLoading(false);
  }

  const handleDelete = async (eventId: string, eventTitle: string) => {
    if (!firestore) return;
    const eventDocRef = doc(firestore, 'upcoming_events', eventId);
    deleteDocumentNonBlocking(eventDocRef);
    toast({title: "Event Deleted", description: `"${eventTitle}" has been removed.`});
  };

  const sortedEvents = useMemo(() => {
    if (!events) return [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return [...events]
        .filter(event => new Date(event.date) >= today)
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
            <CardTitle>Upcoming Events</CardTitle>
            <CardDescription>Important dates and events for everyone.</CardDescription>
        </div>
        {isAdmin && (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Event
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Upcoming Event</DialogTitle>
                <DialogDescription>
                  This event will be visible to all users on their dashboard.
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                  <FormField
                    control={form.control}
                    name="title"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Event Title</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g., UK University Fair" {...field} />
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
                        <FormLabel>Event Date</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant={"outline"}
                                className={cn(
                                  "w-full pl-3 text-left font-normal",
                                  !field.value && "text-muted-foreground"
                                )}
                              >
                                {field.value ? (
                                  format(field.value, "PPP")
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
                              disabled={(date) => date < new Date()}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea placeholder="A short description of the event..." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <DialogFooter>
                      <DialogClose asChild>
                          <Button variant="outline">Cancel</Button>
                      </DialogClose>
                      <Button type="submit" disabled={isLoading}>
                          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Add Event
                      </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {areEventsLoading ? (
            <div className="text-center text-muted-foreground py-10">
              <Loader2 className="mx-auto h-8 w-8 animate-spin" />
            </div>
          ) : sortedEvents.length > 0 ? (
            sortedEvents.map((event) => (
              <div key={event.id} className="flex items-start gap-4 group">
                  <div className="flex h-[68px] w-20 flex-col items-center justify-center rounded-md bg-muted p-2 text-center">
                      {isClient ? (
                        <>
                          <span className="text-sm font-bold text-primary">{format(new Date(event.date), 'MMM')}</span>
                          <span className="text-2xl font-bold">{format(new Date(event.date), 'dd')}</span>
                        </>
                      ) : (
                        <>
                          <div className="h-4 w-8 animate-pulse rounded-sm bg-muted-foreground/20" />
                          <div className="mt-1 h-7 w-8 animate-pulse rounded-sm bg-muted-foreground/20" />
                        </>
                      )}
                  </div>
                  <div className="flex-1">
                      <h3 className="font-semibold">{event.title}</h3>
                      <p className="text-sm text-muted-foreground">{event.description}</p>
                  </div>
                  {isAdmin && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                            <AlertDialogDescription>
                            This will permanently delete the event "{event.title}".
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(event.id, event.title)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
              </div>
            ))
          ) : (
            <p className="text-center text-muted-foreground py-10">No upcoming events.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
