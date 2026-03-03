'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, RequestType, Application } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Calendar as CalendarIcon, GraduationCap } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { UploadDocumentDialog } from '../student/upload-document-dialog';
import { Badge } from '../ui/badge';

interface DynamicTaskFormProps {
  student: Student;
  requestType: RequestType;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

const IELTS_COURSE_OPTIONS = [
  'One week "ielts" In-Person',
  'One week "ielts" Online',
  'One month "ielts" In-Person',
  'One on One class Inperson'
];

export function DynamicTaskForm({ student, requestType, onSubmit, onCancel, isSubmitting }: DynamicTaskFormProps) {
  const config = requestType.specialConfig;
  
  // Dynamic Schema Builder
  const schemaFields: any = {
    notes: z.string().optional(),
  };

  if (requestType.isSpecialTask && config) {
    if (config.examTypes?.includes('ielts') || config.examTypes?.includes('toefl')) {
      schemaFields.examType = z.enum(['ielts', 'toefl', 'ielts_retake', 'ielts_course'] as any).optional();
      schemaFields.ieltsSubtype = z.string().optional();
      schemaFields.requestedDate = z.date().optional();
      schemaFields.amount = z.coerce.number().optional();
    }

    if (config.examTypes?.includes('ielts_retake')) {
      schemaFields.examType = z.literal('ielts_retake').optional();
      schemaFields.idpUsername = z.string().min(1, 'IDP Username is required');
      schemaFields.idpPassword = z.string().min(1, 'IDP Password is required');
      schemaFields.retakeSection = z.string({ required_error: 'Select a section to retake' });
      schemaFields.preferredDate = z.date({ required_error: 'Preferred date is required' });
      schemaFields.preferredTime = z.enum(['10:00 AM', '1:30 PM', '5:00 PM'], { required_error: 'Preferred time is required' });
      schemaFields.originalExamDate = z.date({ required_error: 'Original exam date is required' });
    }

    if (config.examTypes?.includes('ielts_course')) {
      schemaFields.examType = z.literal('ielts_course').optional();
      schemaFields.courseOption = z.string({ required_error: 'Please select a course option' });
      schemaFields.courseStartDate = z.date({ required_error: 'Course start date is required' });
    }

    if (config.studentInfo?.passportNameField) {
      schemaFields.passportName = z.string().optional();
    }
    if (config.documents?.allowSelection) {
      schemaFields.selectedDocuments = z.array(z.string()).default([]);
    }
  }

  // University Selection Logic
  if (config?.requireUniversitySelection) {
    schemaFields.selectedApplicationId = z.string({ required_error: 'Please select a university application' }).min(1, 'Selection is required');
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
      retakeSection: undefined,
      courseOption: undefined,
      examType: config?.examTypes?.length === 1 ? config.examTypes[0] : undefined,
      selectedApplicationId: '',
    },
  });

  const watchExamType = form.watch('examType');
  const watchDocs = form.watch('selectedDocuments') || [];

  const handleDocToggle = (docId: string) => {
    const current = form.getValues('selectedDocuments') || [];
    if (current.includes(docId)) {
      form.setValue('selectedDocuments', current.filter((id: string) => id !== docId));
    } else {
      form.setValue('selectedDocuments', [...current, docId]);
    }
  };

  const handleApplicationSelect = (app: Application) => {
    // We store a combined string as the ID for simple identification in the radio group
    const appId = `${app.university}|${app.major}`;
    form.setValue('selectedApplicationId', appId);
    // Also store formatted details for the server action
    form.setValue('selectedApplicationDetails', {
        university: app.university,
        major: app.major,
        country: app.country,
        status: app.status
    });
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

        {/* University Selection Section */}
        {config?.requireUniversitySelection && (
          <div className="space-y-4 border-t pt-4">
            <FormLabel className="text-base font-bold flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Select Targeted University Application *
            </FormLabel>
            <FormField
              control={form.control}
              name="selectedApplicationId"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormControl>
                    <RadioGroup
                      onValueChange={(val) => {
                        field.onChange(val);
                        const [uni, major] = val.split('|');
                        const app = student.applications.find(a => a.university === uni && a.major === major);
                        if (app) handleApplicationSelect(app);
                      }}
                      value={field.value}
                      className="grid grid-cols-1 gap-3"
                    >
                      {student.applications && student.applications.length > 0 ? (
                        student.applications.map((app, idx) => (
                          <FormItem key={idx} className="flex items-center space-x-3 space-y-0 border p-4 rounded-lg bg-background hover:bg-muted/20 transition-colors cursor-pointer">
                            <FormControl>
                              <RadioGroupItem value={`${app.university}|${app.major}`} />
                            </FormControl>
                            <FormLabel className="font-medium cursor-pointer flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <span className="block text-sm font-bold">{app.university}</span>
                                <span className="block text-xs text-muted-foreground">{app.major}</span>
                              </div>
                              <div className="flex items-center gap-2 md:justify-end">
                                <Badge variant="outline" className="text-[10px] uppercase font-mono">{app.country}</Badge>
                                <Badge variant="secondary" className="text-[10px] uppercase">{app.status}</Badge>
                              </div>
                            </FormLabel>
                          </FormItem>
                        ))
                      ) : (
                        <div className="text-center py-8 border rounded-lg border-dashed bg-red-50 text-red-600">
                            <p className="text-sm font-bold">No active applications found for this student.</p>
                            <p className="text-xs mt-1">Please add a university application to the profile first.</p>
                        </div>
                      )}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Exam Type Selection (If multiple) */}
        {requestType.isSpecialTask && config?.examTypes && config.examTypes.length > 1 && (
          <FormField
            control={form.control}
            name="examType"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Select Exam/Course Category *</FormLabel>
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
                          {type.replace('_', ' ')}
                        </FormLabel>
                      </FormItem>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* IELTS / TOEFL Logic */}
        {(watchExamType === 'ielts' || watchExamType === 'toefl') && config && (
          <div className="space-y-4 border-t pt-4 animate-in fade-in">
            {watchExamType === 'ielts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                                const today = startOfDay(new Date());
                                const rule = config.ielts?.dateRule || '5_days_from_today';
                                const minDate = rule === '5_days_from_today' ? addDays(today, 5) : today;
                                return date < minDate;
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Min 5 days from today.</FormDescription>
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
                        <FormLabel>Exam Price ({config.ielts.amountCurrency || 'KWD'}) *</FormLabel>
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

        {/* IELTS RETAKE LOGIC */}
        {watchExamType === 'ielts_retake' && config && (
          <div className="space-y-6 border-t pt-4 animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="idpUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP Username *</FormLabel>
                    <FormControl><Input placeholder="Enter username" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="idpPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP Password *</FormLabel>
                    <FormControl><Input type="text" placeholder="Enter password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <FormLabel>Select Section to Retake *</FormLabel>
              <FormField
                control={form.control}
                name="retakeSection"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid grid-cols-2 md:grid-cols-4 gap-4"
                      >
                        {['Listening', 'Reading', 'Writing', 'Speaking'].map((section) => (
                          <FormItem key={section} className="flex items-center space-x-2 space-y-0 border p-3 rounded-md">
                            <FormControl>
                              <RadioGroupItem value={section} />
                            </FormControl>
                            <FormLabel className="font-medium cursor-pointer">{section}</FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="preferredDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Preferred Exam Date *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
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
                          disabled={(date) => date < addDays(startOfDay(new Date()), 3)}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>Min 3 days from today.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="preferredTime"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Preferred Time *</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                        {['10:00 AM', '1:30 PM', '5:00 PM'].map((time) => (
                          <FormItem key={time} className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value={time} /></FormControl>
                            <FormLabel className="font-normal">{time}</FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="originalExamDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Original Exam Date *</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Pick original date</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={field.value}
                        onSelect={field.onChange}
                        disabled={(date) => date > startOfDay(new Date())}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormDescription>Must be in the past.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* IELTS COURSE LOGIC */}
        {watchExamType === 'ielts_course' && config && (
          <div className="space-y-6 border-t pt-4 animate-in fade-in">
            <FormField
              control={form.control}
              name="courseOption"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Select Course Option *</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    >
                      {IELTS_COURSE_OPTIONS.map((option) => (
                        <FormItem key={option} className="flex items-center space-x-3 space-y-0 border p-4 rounded-lg bg-muted/20">
                          <FormControl>
                            <RadioGroupItem value={option} />
                          </FormControl>
                          <FormLabel className="font-medium cursor-pointer">{option}</FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="courseStartDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Course Start Date (Sundays Only) *</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Select a Sunday</span>}
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
                          const today = startOfDay(new Date());
                          // Disable if not Sunday (0) OR if in the past
                          return date.getDay() !== 0 || date < today;
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>
                  <FormDescription>Courses start every Sunday. Please select a future Sunday.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
