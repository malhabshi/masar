
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { User, Task } from '@/lib/types';
import { sendTask as sendTaskAction } from '@/lib/actions';
import { Loader2, Send } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { addDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';
import type { AppUser } from '@/hooks/use-user';

interface SendTaskFormProps {
  currentUser: AppUser;
}

const formSchema = z.object({
  content: z.string().min(5, { message: 'Update message must be at least 5 characters.' }),
  recipient: z.string().optional(),
});

export function SendTaskForm({ currentUser }: SendTaskFormProps) {
  const { toast } = useToast();
  const [sendTo, setSendTo] = useState<'all' | 'specific'>('all');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const { users, usersLoading } = useUsers();
  const recipients = useMemo(() => users.filter(u => u.role === 'employee' || u.role === 'department'), [users]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      content: '',
      recipient: undefined,
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!currentUser) return;

    setIsSubmitting(true);
    const recipientId = sendTo === 'all' ? 'all' : values.recipient;
    
    if (sendTo === 'specific' && !recipientId) {
        toast({ variant: 'destructive', title: 'Error', description: 'Please select a recipient.' });
        setIsSubmitting(false);
        return;
    }
    
    // Call server action for side-effects like notifications
    const result = await sendTaskAction(currentUser.id, recipientId!, values.content);

    if (result.success) {
      // Add to client-side state
      const tasksCollection = collection(firestore, 'tasks');
      const newTask: Omit<Task, 'id'> = {
        authorId: currentUser.id,
        recipientId: recipientId!,
        content: values.content,
        createdAt: new Date().toISOString(),
        status: 'new',
        replies: [],
      };
      addDocumentNonBlocking(tasksCollection, newTask);

      toast({
        title: 'Update Sent!',
        description: result.message,
      });
      form.reset();
      setSendTo('all');
    } else {
      toast({
        variant: 'destructive',
        title: 'Failed to send update',
        description: result.message,
      });
    }
    setIsSubmitting(false);
  }

  const isLoading = isSubmitting || usersLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>Send an update to all employees or a specific user.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Recipient</Label>
              <RadioGroup
                defaultValue="all"
                value={sendTo}
                onValueChange={(value: 'all' | 'specific') => setSendTo(value)}
                className="flex gap-4"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="all" id="r1" />
                  <Label htmlFor="r1" className="font-normal">All Employees</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="specific" id="r2" />
                  <Label htmlFor="r2" className="font-normal">Specific User</Label>
                </div>
              </RadioGroup>
            </div>

            {sendTo === 'specific' && (
              <FormField
                  control={form.control}
                  name="recipient"
                  render={({ field }) => (
                  <FormItem>
                      <FormLabel>Recipient</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                          <SelectTrigger disabled={usersLoading}>
                              <SelectValue placeholder={usersLoading ? "Loading users..." : "Select a recipient"} />
                          </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                          {recipients.map(rec => (
                              <SelectItem key={rec.id} value={rec.id}>{rec.name} ({rec.role})</SelectItem>
                          ))}
                          </SelectContent>
                      </Select>
                      <FormMessage />
                  </FormItem>
                  )}
              />
            )}

            <FormField
              control={form.control}
              name="content"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Update Message</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Please review the new applicants..."
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isLoading} className="ml-auto">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send Update
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
    
