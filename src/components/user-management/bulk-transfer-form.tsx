'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { bulkTransferStudents, triggerWhatsAppNotification } from '@/lib/actions';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { User, Task } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { addDocumentNonBlocking, useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Skeleton } from '../ui/skeleton';

const formSchema = z.object({
  fromEmployeeId: z.string().min(1, { message: 'Please select an employee to transfer from.' }),
  toEmployeeId: z.string().min(1, { message: 'Please select an employee to transfer to.' }),
}).refine(data => data.fromEmployeeId !== data.toEmployeeId, {
    message: "Cannot transfer to the same employee.",
    path: ["toEmployeeId"],
});

interface BulkTransferFormProps {
    currentUser: AppUser;
}

export function BulkTransferForm({ currentUser }: BulkTransferFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const { data: usersData, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');

  const employeeOptions = useMemo(() => (usersData || []).filter(u => u.role === 'employee'), [usersData]);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
        fromEmployeeId: '',
        toEmployeeId: '',
    },
  });

  const fromEmployeeId = form.watch('fromEmployeeId');
  const toEmployeeOptions = employeeOptions.filter(e => e.id !== fromEmployeeId);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    if (!currentUser) {
        toast({ variant: 'destructive', title: 'Error', description: 'User session not available.' });
        setIsLoading(false);
        return;
    }

    const result = await bulkTransferStudents(values.fromEmployeeId, values.toEmployeeId, currentUser.id);

    if (result.success && result.studentIds) {
      const oldEmployee = employeeOptions.find(e => e.id === values.fromEmployeeId);
      const studentIds = result.studentIds;
      const taskContent = `You have received ${studentIds.length} students from ${oldEmployee?.name || 'an employee'}`;

      // Create the complex task record as requested for feed visibility and tracking
      const tasksCollection = collection(firestore, 'tasks');
      const newTask: Omit<Task, 'id'> = {
        authorId: currentUser.id,
        authorName: currentUser.name,
        recipientId: values.toEmployeeId,                    
        recipientIds: [values.toEmployeeId, 'all'],          
        category: 'system',                                   
        taskType: 'Bulk Student Transfer',
        type: 'bulk_transfer',                                
        content: taskContent,
        data: {
          studentCount: studentIds.length,
          transferredBy: currentUser.name,
          fromEmployeeId: values.fromEmployeeId,
          fromEmployeeName: oldEmployee?.name,
          studentIds: studentIds                              
        },
        createdAt: new Date().toISOString(),
        status: 'new',
        replies: []
      };
      
      addDocumentNonBlocking(tasksCollection, newTask);

      // Trigger WhatsApp Notification for the new owner
      if (result.toEmployeePhone) {
        await triggerWhatsAppNotification('admin_update', {
          employeeName: result.toEmployeeName || 'Employee',
          messageContent: taskContent,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/applicants`
        }, result.toEmployeePhone);
      }
      
      toast({
        title: 'Bulk Transfer Successful!',
        description: result.message,
      });
      form.reset();
    } else {
      toast({
        variant: 'destructive',
        title: 'Bulk Transfer Failed',
        description: result.message || 'An error occurred during transfer.',
      });
    }
    setIsLoading(false);
  }

  if (usersLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bulk Student Transfer</CardTitle>
          <CardDescription>Reassign entire student portfolios.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
        </CardContent>
        <CardFooter><Button disabled className="w-full">Loading employees...</Button></CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Student Transfer</CardTitle>
        <CardDescription>Reassign all students from an offboarding employee to a new owner.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="fromEmployeeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offboarding Employee</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select current owner" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {employeeOptions.map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
             <FormField
              control={form.control}
              name="toEmployeeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Responsible Employee</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!fromEmployeeId}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select destination" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {toEmployeeOptions.map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>{emp.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isLoading || !fromEmployeeId} className="w-full">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Execute Portfolio Transfer
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}