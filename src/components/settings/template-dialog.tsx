
'use client';

import { useEffect, useState, useMemo } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
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
import { Loader2, SendHorizontal, Phone, Sparkles, Link as LinkIcon, Plus, Trash2, Zap } from 'lucide-react';
import type { NotificationTypeMeta } from './notification-templates-manager';
import { sendSampleWebhookRequest } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

const templateSchema = z.object({
  notificationType: z.string().min(1, 'Type is required.'),
  templateName: z.string().min(3, 'Name is required.'),
  message: z.string().min(10, 'Message body is required.'),
  webhookUrl: z.string().url('Please enter a valid WANotifier webhook URL.').optional().or(z.literal('')),
  isActive: z.boolean().default(true),
  variables: z.array(z.string()).default([]),
  mapping: z.array(z.object({
    placeholder: z.string().min(1),
    systemVar: z.string().min(1),
  })).default([]),
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
  types: NotificationTypeMeta[];
}) {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isSendingSample, setIsSendingSample] = useState(false);

  const form = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      notificationType: '',
      templateName: '',
      message: '',
      webhookUrl: '',
      isActive: true,
      variables: [],
      mapping: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "mapping",
  });

  useEffect(() => {
    if (isOpen) {
      const mappingArray = template?.variableMapping 
        ? Object.entries(template.variableMapping).map(([k, v]) => ({ placeholder: k, systemVar: v }))
        : [];

      form.reset({
        notificationType: template?.notificationType || '',
        templateName: template?.templateName || '',
        message: template?.message || '',
        webhookUrl: template?.webhookUrl || '',
        isActive: template?.isActive ?? true,
        variables: template?.variables || [],
        mapping: mappingArray,
      });
    }
  }, [isOpen, template, form]);

  const watchType = form.watch('notificationType');
  const watchWebhook = form.watch('webhookUrl');
  const activeTypeMeta = types.find(t => t.type === watchType);
  const availableVars = activeTypeMeta?.variables || [];

  const handleAddVar = (v: string) => {
    const current = form.getValues('message');
    form.setValue('message', current + ` {{${v}}}`);
    const currentVars = form.getValues('variables');
    if (!currentVars.includes(v)) {
      form.setValue('variables', [...currentVars, v]);
    }
  };

  const handleAddPlaceholder = (placeholderNum: string) => {
    const current = form.getValues('message');
    form.setValue('message', current + ` {{${placeholderNum}}}`);
  };

  const handleUseDefault = () => {
    if (!activeTypeMeta) return;
    form.setValue('message', activeTypeMeta.exampleMessage);
    form.setValue('variables', activeTypeMeta.variables);
    if (!form.getValues('templateName')) {
        form.setValue('templateName', activeTypeMeta.label);
    }
  };

  const handleSendSample = async () => {
    if (!watchWebhook) return;
    setIsSendingSample(true);
    
    const mapping: Record<string, string> = {};
    form.getValues('mapping').forEach(m => {
      mapping[m.placeholder] = m.systemVar;
    });

    const result = await sendSampleWebhookRequest(watchWebhook, mapping);
    if (result.success) {
      toast({ title: 'Sample Sent', description: 'Sample POST request sent to webhook successfully.' });
    } else {
      toast({ variant: 'destructive', title: 'Sample Failed', description: result.message });
    }
    setIsSendingSample(false);
  };

  const onSubmit = async (values: z.infer<typeof templateSchema>) => {
    setIsSubmitting(true);
    
    // Convert mapping array back to object for storage
    const variableMapping: Record<string, string> = {};
    values.mapping.forEach(m => {
      variableMapping[m.placeholder] = m.systemVar;
    });

    await onSave({
      ...values,
      variableMapping,
    });
    setIsSubmitting(false);
  };

  const handleTestClick = async () => {
    if (!template?.id || !testPhone) return;
    setIsTesting(true);
    await onTest(template.id, testPhone);
    setIsTesting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{template ? 'Edit' : 'Add'} WhatsApp Template</DialogTitle>
          <DialogDescription>
            Configure your WhatsApp message and map numbered placeholders ({"{{"}1{"}}"}) to system variables.
          </DialogDescription>
        </DialogHeader>
        
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="space-y-6">
                <FormField control={form.control} name="notificationType" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notification Type</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger></FormControl>
                      <SelectContent>
                        {types.map(t => <SelectItem key={t.type} value={t.type}>{t.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormDescription>Choose which system event triggers this message.</FormDescription>
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

                <FormField control={form.control} name="webhookUrl" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <LinkIcon className="h-3 w-3 text-primary" />
                        WANotifier Webhook URL
                      </div>
                      {field.value && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-6 text-[10px] font-bold bg-primary/10 text-primary hover:bg-primary/20"
                          onClick={handleSendSample}
                          disabled={isSendingSample}
                        >
                          {isSendingSample ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Zap className="h-3 w-3 mr-1" />}
                          Send Sample Request
                        </Button>
                      )}
                    </FormLabel>
                    <FormControl><Input placeholder="https://app.wanotifier.com/api/v1/notifications/..." {...field} /></FormControl>
                    <FormDescription>Step 2: Send a sample POST request to help WANotifier learn your mapping.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="p-4 rounded-lg border bg-muted/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-primary font-bold">Placeholder Mapping</FormLabel>
                    <Button type="button" variant="outline" size="sm" onClick={() => append({ placeholder: (fields.length + 1).toString(), systemVar: '' })}>
                      <Plus className="h-3 w-3 mr-1" /> Add Placeholder
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest">
                    Map numbering ({"{{"}1{"}}"}), ({"{{"}2{"}}"}) to system fields
                  </p>
                  
                  {fields.length > 0 ? (
                    <div className="space-y-3">
                      {fields.map((field, index) => (
                        <div key={field.id} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-1">
                          <div className="flex-1 flex items-center gap-2 bg-background border p-1 rounded-md">
                            <span className="text-xs font-mono font-bold px-2 text-primary border-r">
                              {"{{"}{fields[index].placeholder}{"}}"}
                            </span>
                            <FormField
                              control={form.control}
                              name={`mapping.${index}.systemVar`}
                              render={({ field }) => (
                                <Select onValueChange={field.onChange} value={field.value}>
                                  <SelectTrigger className="border-0 focus:ring-0 h-7 text-xs">
                                    <SelectValue placeholder="Select field" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {availableVars.map(v => (
                                      <SelectItem key={v} value={v}>{v}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              )}
                            />
                          </div>
                          <Button 
                            type="button" 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-destructive" 
                            onClick={() => remove(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs italic text-muted-foreground text-center py-2">No numbered placeholders defined yet.</p>
                  )}
                </div>

                <FormField control={form.control} name="isActive" render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm bg-muted/10">
                    <div className="space-y-0.5"><FormLabel>Active Status</FormLabel></div>
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </div>

              <div className="space-y-6">
                <FormField control={form.control} name="message" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center justify-between">
                        <span>WhatsApp Message (Reference)</span>
                        <span className="text-[10px] text-muted-foreground font-normal">Used for local preview only</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Type your WhatsApp message here..." 
                        className="min-h-[250px] font-mono text-sm leading-relaxed" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase text-muted-foreground tracking-widest">Available System Fields</p>
                    <div className="flex flex-wrap gap-1.5">
                      {availableVars.length > 0 ? availableVars.map(v => (
                        <Badge 
                          key={v} 
                          variant="secondary" 
                          className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all text-[10px] font-mono py-1 px-2"
                          onClick={() => handleAddVar(v)}
                        >
                          {"{{"}{v}{"}}"}
                        </Badge>
                      )) : <p className="text-xs italic text-muted-foreground">Select a notification type to see available variables.</p>}
                    </div>
                  </div>

                  {fields.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase text-primary tracking-widest">Active Mapped Placeholders</p>
                      <div className="flex flex-wrap gap-1.5">
                        {fields.map((f, i) => (
                          <Badge 
                            key={i} 
                            variant="outline" 
                            className="cursor-pointer border-primary text-primary hover:bg-primary hover:text-white transition-all text-[10px] font-mono py-1 px-2"
                            onClick={() => handleAddPlaceholder(fields[i].placeholder)}
                          >
                            {"{{"}{fields[i].placeholder}{"}}"}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {activeTypeMeta && (
                    <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-primary flex items-center gap-2">
                                <Sparkles className="h-4 w-4" />
                                System Recommendation
                            </h4>
                            <Button type="button" variant="link" size="sm" className="h-auto p-0 font-bold" onClick={handleUseDefault}>
                                Use default text
                            </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground italic leading-relaxed whitespace-pre-wrap font-mono bg-background/50 p-2 rounded">
                            {activeTypeMeta.exampleMessage}
                        </p>
                    </div>
                )}
              </div>
            </div>

            {template && (
              <div className="border-t pt-6 bg-muted/20 p-6 rounded-xl border-dashed">
                <h4 className="text-sm font-bold flex items-center gap-2 mb-4">
                  <SendHorizontal className="h-4 w-4 text-primary" />
                  Test Delivery
                </h4>
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input 
                      placeholder="Recieving Phone (e.g. 55123456)" 
                      className="pl-9" 
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                    />
                  </div>
                  <Button 
                    type="button" 
                    variant="secondary" 
                    className="font-bold gap-2"
                    disabled={!testPhone || isTesting || !form.getValues('webhookUrl')}
                    onClick={handleTestClick}
                  >
                    {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                    Send Test WhatsApp
                  </Button>
                </div>
                {!form.getValues('webhookUrl') && (
                  <p className="text-[10px] text-destructive mt-2 italic font-bold">Please configure a Webhook URL to send test messages.</p>
                )}
                <p className="text-[10px] text-muted-foreground mt-3 italic">Note: Test messages will use your custom Placeholder Mapping.</p>
              </div>
            )}

            <DialogFooter className="border-t pt-6">
              <DialogClose asChild><Button variant="outline" type="button" className="px-8">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting} className="px-8 font-bold">
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
