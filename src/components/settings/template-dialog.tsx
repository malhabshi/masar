
'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { NotificationTemplate, NotificationType } from '@/lib/types';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogClose
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Form, 
  FormControl, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormMessage,
  FormDescription
} from '@/components/ui/form';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, SendHorizontal, Phone } from 'lucide-react';

const templateSchema = z.object({
  notificationType: z.string().min(1, 'Type is required.'),
  templateName: z.string().min(3, 'Name is required.'),
  message: z.string().min(10, 'Message body is required.'),
  isActive: z.boolean().default(true),
  variables: z.array(z.string()).default([]),
});

export function TemplateDialog({
  isOpen,
  setIsOpen,
  template,
  onSave,
  onTest,
  types
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  template?: NotificationTemplate;
  onSave: (values: any) => Promise<void>;
  onTest: (id: string, phone: string) => Promise<void>;
  types: { type: NotificationType; label: string; variables: string[] }[];
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [isTesting, setIsTesting] = useState(false);

  const form = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      notificationType: '',
      templateName: '',
      message: '',
      isActive: true,
      variables: [],
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        notificationType: template?.notificationType || '',
        templateName: template?.templateName || '',
        message: template?.message || '',
        isActive: template?.isActive ?? true,
        variables: template?.variables || [],
      });
    }
  }, [isOpen, template, form]);

  const watchType = form.watch('notificationType');
  const availableVars = types.find(t => t.type === watchType)?.variables || [];

  const handleAddVar = (v: string) => {
    const current = form.getValues('message');
    form.setValue('message', current + ` {{${v}}}`);
    const currentVars = form.getValues('variables');
    if (!currentVars.includes(v)) {
      form.setValue('variables', [...currentVars, v]);
    }
  };

  const onSubmit = async (values: z.infer<typeof templateSchema>) => {
    setIsSubmitting(true);
    await onSave(values);
    setIsSubmitting(false);
  };

  const handleTestClick = async () => {
    if (!template?.id || !testPhone) return;
    setIsTesting(true);
    // Use currently entered variables from form or template
    const dummyVars: Record<string, string> = {};
    availableVars.forEach(v => dummyVars[v] = `[${v}]`);
    
    await onTest(template.id, testPhone);
    setIsTesting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit' : 'Add'} WhatsApp Template</DialogTitle>
          <DialogDescription>Configure how WhatsApp messages look for specific system events.</DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <FormField control={form.control} name="notificationType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notification Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {types.map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="templateName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Template Name</FormLabel>
                    <FormControl><Input placeholder="e.g., Task Assignment Alert" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5"><FormLabel>Active Status</FormLabel></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <div className="space-y-4">
                <FormField control={form.control} name="message" render={({ field }) => (
                  <FormItem>
                    <FormLabel>WhatsApp Message</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Type your WhatsApp message here..." 
                        className="min-h-[150px] font-mono text-xs" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase text-muted-foreground">Available Variables</p>
                  <div className="flex flex-wrap gap-1">
                    {availableVars.length > 0 ? availableVars.map(v => (
                      <Badge 
                        key={v} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-colors"
                        onClick={() => handleAddVar(v)}
                      >
                        {`{{${v}}}`}
                      </Badge>
                    )) : <p className="text-xs italic text-muted-foreground">Select a type first...</p>}
                  </div>
                </div>
              </div>
            </div>

            {template && (
              <div className="border-t pt-6 bg-muted/20 p-4 rounded-lg">
                <h4 className="text-sm font-bold flex items-center gap-2 mb-4">
                  <SendHorizontal className="h-4 w-4 text-primary" />
                  Test Delivery
                </h4>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Enter phone number (e.g. 55123456)" 
                      className="pl-8" 
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                    />
                  </div>
                  <Button 
                    type="button" 
                    variant="secondary" 
                    disabled={!testPhone || isTesting}
                    onClick={handleTestClick}
                  >
                    {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Send Test
                  </Button>
                </div>
              </div>
            )}

            <DialogFooter>
              <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save Template
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
