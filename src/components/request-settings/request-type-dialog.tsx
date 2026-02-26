
'use client';

import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { RequestType, User } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { RecipientSelector } from './recipient-selector';
import { SpecialTaskConfigSection } from './special-task-config';

const requestTypeSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters.'),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
  recipients: z.array(z.any()).min(1, 'At least one recipient is required.'),
  requiredFields: z.string().optional(),
  isActive: z.boolean().default(true),
  isSpecialTask: z.boolean().default(false),
  specialConfig: z.any().optional(),
});

export function RequestTypeDialog({
  isOpen,
  setIsOpen,
  requestType,
  onSubmit,
  users,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  requestType?: RequestType;
  onSubmit: (values: any) => void;
  users: User[];
}) {
  const form = useForm<z.infer<typeof requestTypeSchema>>({
    resolver: zodResolver(requestTypeSchema),
    defaultValues: {
      name: '',
      description: '',
      recipients: [],
      requiredFields: '',
      isActive: true,
      isSpecialTask: false,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: requestType?.name || '',
        description: requestType?.description || '',
        recipients: requestType?.recipients || [],
        requiredFields: requestType?.requiredFields?.join('\n') || '',
        isActive: requestType?.isActive ?? true,
        isSpecialTask: requestType?.isSpecialTask || false,
        specialConfig: requestType?.specialConfig || undefined,
      });
    }
  }, [isOpen, form, requestType]);

  const handleSubmit = (values: z.infer<typeof requestTypeSchema>) => {
    const formattedValues = {
      ...values,
      requiredFields: values.requiredFields ? values.requiredFields.split('\n').filter(Boolean) : [],
    };
    onSubmit(formattedValues);
  };

  const isSpecialTask = form.watch('isSpecialTask');

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{requestType ? 'Edit' : 'Add'} Request Type</DialogTitle>
          <DialogDescription>Define a standard request category and its routing rules.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g., Document Request" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Explain what this request is for." {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="recipients" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Recipients</FormLabel>
                    <RecipientSelector value={field.value} onChange={field.onChange} users={users} />
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="space-y-4">
                <FormField control={form.control} name="requiredFields" render={({ field }) => (
                  <FormItem><FormLabel>Required Fields (One per line)</FormLabel><FormControl><Textarea placeholder="e.g.&#10;Student ID&#10;Document Type" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                    <div className="space-y-0.5"><FormLabel>Active Status</FormLabel></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="isSpecialTask" render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4 bg-primary/5">
                    <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>This is a special/custom task type</FormLabel>
                      <FormDescription>Enable advanced configuration for specific exams like IELTS or TOEFL.</FormDescription>
                    </div>
                  </FormItem>
                )} />
              </div>
            </div>

            {isSpecialTask && (
              <div className="border-t pt-6">
                <SpecialTaskConfigSection form={form} />
              </div>
            )}

            <DialogFooter className="sticky bottom-0 bg-background pt-4 border-t">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit">Save Request Type</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
