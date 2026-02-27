'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, RequestType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Calendar as CalendarIcon, UploadCloud } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { UploadDocumentDialog } from '../student/upload-document-dialog';

interface DynamicTaskFormProps {
  student: Student;
  requestType: RequestType;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function DynamicTaskForm({ student, requestType, onSubmit, onCancel, isSubmitting }: DynamicTaskFormProps) {
  const config = requestType.specialConfig;
  
  // Dynamic Schema Builder
  const schemaFields: any = {
    notes: z.string().optional(),
  };

  if (requestType.isSpecialTask && config) {
    if (config.examTypes?.length > 0) {
      schemaFields.examType = z.enum(['ielts', 'toefl'] as any);
      schemaFields.ieltsSubtype = z.string().optional();
      schemaFields.requestedDate = z.date().optional();
      schemaFields.amount = z.coerce.number().optional();
    }
    if (config.studentInfo?.passportNameField) {
      schemaFields.passportName = z.string().optional();
    }
    if (config.documents?.allowSelection) {
      schemaFields.selectedDocuments = z.array(z.string()).default([]);
    }
  }

  const formSchema = z.object(schemaFields).refine(data => {
    if (data.examType === 'ielts' && config?.ielts) {
      if (config.ielts.showSubtypes && !data.ieltsSubtype) return false;
      if (config.ielts.showDates && !data.requestedDate) return false;
      if (config.ielts.showAmount && !data.amount) return false;
    }
    return true;
  }, {
    message: "Please fill in all required exam details.",
    path: ["examType"]
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      notes: '',
      selectedDocuments: [],
    },
  });

  const watchExamType = form.watch('examType');
  const watchDocs = form.watch('selectedDocuments') || [];

  const handleDocToggle = (docId: string) => {
    const current = form.getValues('selectedDocuments') || [];
    if (current.includes(docId)) {
      form.setValue('selectedDocuments', current.filter(id => id !== docId));
    } else {
      form.setValue('selectedDocuments', [...current, docId]);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
        {/* Student Info Read-Only Section */}
        <div className="bg-muted/30 p-4 rounded-lg border border-dashed space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Student Information</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-semibold">{student.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-semibold">{student.email || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-semibold">{student.phone}</p>
            </div>
          </div>
          {config?.studentInfo?.passportNameField && (
            <FormField
              control={form.control}
              name="passportName"
              render={({ field }) => (
                <FormItem className="pt-2">
                  <FormLabel>Passport Name (If different)</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter full name as shown on passport" {...field} />
                  </FormControl>
                  <FormDescription>Fill this if required for the official registration.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {/* Special Config Exam Section */}
        {requestType.isSpecialTask && config?.examTypes?.length > 0 && (
          <div className="space-y-4 border-t pt-4">
            <FormField
              control={form.control}
              name="examType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Select Exam Type *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="flex flex-col space-y-1"
                    >
                      {config.examTypes.map((type: string) => (
                        <FormItem key={type} className="flex items-center space-x-3 space-y-0">
                          <FormControl>
                            <RadioGroupItem value={type} />
                          </FormControl>
                          <FormLabel className="font-normal uppercase">
                            {type}
                          </FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchExamType === 'ielts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">
                {config.ielts?.showSubtypes && (
                  <FormField
                    control={form.control}
                    name="ieltsSubtype"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>IELTS Type *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select subtype" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="academic">Academic</SelectItem>
                            <SelectItem value="ukvi">UKVI</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {config.ielts?.showDates && (
                  <FormField
                    control={form.control}
                    name="requestedDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Requested Date *</FormLabel>
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
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => {
                                const minDate = config.ielts.dateRule === '5_days_from_today' ? addDays(new Date(), 5) : new Date();
                                return date < minDate;
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {config.ielts?.showAmount && (
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount ({config.ielts.amountCurrency || 'KWD'}) *</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="0.00" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* Document Selection Section */}
        {config?.documents?.allowSelection && (
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <FormLabel>Select Documents</FormLabel>
              {config.documents.allowUpload && (
                <UploadDocumentDialog student={student} />
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-2 border rounded-md bg-muted/10">
              {student.documents?.length > 0 ? (
                student.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center space-x-3 p-2 rounded hover:bg-muted/50 transition-colors">
                    <Checkbox 
                      id={`doc-${doc.id}`} 
                      checked={watchDocs.includes(doc.id)} 
                      onCheckedChange={() => handleDocToggle(doc.id)}
                    />
                    <label htmlFor={`doc-${doc.id}`} className="text-xs truncate cursor-pointer flex-1">
                      {doc.name}
                    </label>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground col-span-2 text-center py-4">No documents available.</p>
              )}
            </div>
            <FormDescription>Select documents from the student profile to include with this request.</FormDescription>
          </div>
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="border-t pt-4">
              <FormLabel>Additional Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Any specific instructions or context..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="sticky bottom-0 bg-background pt-4 border-t flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Request
          </Button>
        </div>
      </form>
    </Form>
  );
}
