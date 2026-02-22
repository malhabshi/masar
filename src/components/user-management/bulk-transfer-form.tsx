'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { bulkTransferStudents } from '@/lib/actions';
import { Loader2, ArrowRightLeft } from 'lucide-react';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { User, Task } from '@/lib/types';
import { firestore, addDocumentNonBlocking } from '@/firebase';
import { collection } from 'firebase/firestore';

const formSchema = z.object({
  fromEmployeeId: z.string().min(1, { message: 'Please select an employee to transfer from.' }),
  toEmployeeId: z.string().min(1, { message: 'Please select an employee to transfer to.' }),
}).refine(data => data.fromEmployeeId !== data.toEmployeeId, {
    message: "Cannot transfer to the same employee.",
    path: ["toEmployeeId"],
});

interface BulkTransferFormProps {
    employees: User[];
    currentUser: User;
}

export function BulkTransferForm({ employees, currentUser }: BulkTransferFormProps) {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  
  const employeeOptions = employees.filter(e => e.role === 'employee');

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
        toast({ variant: 'destructive', title: 'Error', description: 'User or database not available.' });
        setIsLoading(false);
        return;
    }
    const result = await bulkTransferStudents(values.fromEmployeeId, values.toEmployeeId, currentUser.id);

    if (result.success) {
      const fromEmployee = employees.find(u => u.id === values.fromEmployeeId);
      const taskContent = `All students from ${fromEmployee?.name} have been transferred to you.`;
      
      const tasksCollection = collection(firestore, 'tasks');
      const newTask: Omit<Task, 'id'> = {
        authorId: currentUser.id,
        recipientId: values.toEmployeeId,
        content: taskContent,
        createdAt: new Date().toISOString(),
        status: 'new',
        replies: []
      };
      addDocumentNonBlocking(tasksCollection, newTask);
      
      toast({
        title: 'Bulk Transfer Successful!',
        description: result.message,
      });
      form.reset();
    } else {
      toast({
        variant: 'destructive',
        title: 'Bulk Transfer Failed',
        description: result.message,
      });
    }
    setIsLoading(false);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk Student Transfer</CardTitle>
        <CardDescription>Transfer all assigned students from one employee to another. This is useful when an employee is leaving the company.</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="fromEmployeeId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Transfer From</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee to transfer from" />
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
                  <FormLabel>Transfer To</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value} disabled={!fromEmployeeId}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select employee to transfer to" />
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
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowRightLeft className="mr-2 h-4 w-4" />}
              Transfer All Students
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
