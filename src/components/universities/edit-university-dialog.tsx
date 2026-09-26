
'use client';

import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Loader2, FilePenLine } from 'lucide-react';
import type { ApprovedUniversity, Country, UniversityCompany } from '@/lib/types';
import {
  EntryRequirementsField,
  cleanEntryRequirements,
  entryRequirementDefaults,
  entryRequirementSchema,
} from './entry-requirements';

const COMPANIES: UniversityCompany[] = ['Into', 'Studygroup', 'Kaplan', 'OnCampus', 'Navitas', 'Other', 'Inhouse'];

const formSchema = z.object({
  name: z.string().min(3, { message: 'University name is required.' }),
  major: z.string().min(3, { message: 'Major is required.' }),
  foundationName: z.string().optional(),
  country: z.enum(['UK', 'USA', 'Australia', 'New Zealand', 'Ireland']),
  category: z.enum(['MOHE', 'Merit', 'General']),
  entryLevels: z.array(z.string()).default([]),
  entryRequirements: z.array(entryRequirementSchema).default([]),
  ieltsScore: z.coerce.number().min(0).max(9),
  isAvailable: z.boolean().default(false),
  notes: z.string().optional(),
  importantNote: z.string().optional(),
  company: z.enum(['Into', 'Studygroup', 'Kaplan', 'OnCampus', 'Navitas', 'Other', 'Inhouse']).optional(),
  schoolOrder: z.preprocess(
    (v) => (v === '' || v == null) ? undefined : Number(v),
    z.number().int().min(1).optional()
  ),
  majorOrder: z.preprocess(
    (v) => (v === '' || v == null) ? undefined : Number(v),
    z.number().int().min(1).optional()
  ),
});

interface EditUniversityDialogProps {
  university: ApprovedUniversity;
  onUpdateUniversity: (university: ApprovedUniversity) => void;
}

export function EditUniversityDialog({ university, onUpdateUniversity }: EditUniversityDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: university.name,
      major: university.major,
      foundationName: university.foundationName || '',
      country: university.country,
      category: university.category || 'General',
      entryLevels: university.entryLevels || [],
      entryRequirements: entryRequirementDefaults(university.entryRequirements),
      ieltsScore: university.ieltsScore,
      isAvailable: university.isAvailable,
      notes: university.notes || '',
      importantNote: university.importantNote || '',
      company: university.company || undefined,
      schoolOrder: university.schoolOrder || undefined,
      majorOrder: university.majorOrder || undefined,
    },
  });

  const universityRef = useRef(university);
  universityRef.current = university;

  useEffect(() => {
    if (isOpen) {
      const u = universityRef.current;
      form.reset({
          name: u.name,
          major: u.major,
          foundationName: u.foundationName || '',
          country: u.country,
          category: u.category || 'General',
          entryLevels: u.entryLevels || [],
          entryRequirements: entryRequirementDefaults(u.entryRequirements),
          ieltsScore: u.ieltsScore,
          isAvailable: u.isAvailable,
          notes: u.notes || '',
          importantNote: u.importantNote || '',
          company: u.company || undefined,
          schoolOrder: u.schoolOrder || undefined,
          majorOrder: u.majorOrder || undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, form]);

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'];

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    onUpdateUniversity({
      ...university,
      ...values,
      // Only ticked levels are saved, and only the boxes that were actually filled in.
      entryRequirements: cleanEntryRequirements(values.entryRequirements, values.entryLevels),
    });
    setIsLoading(false);
    setIsOpen(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon">
            <FilePenLine className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Approved University</DialogTitle>
          <DialogDescription>
            Update the details for {university.name}.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>University Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., University of Toronto" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="major"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Major Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Computer Science" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="foundationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Foundation Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., International Foundation in Science and Engineering"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Only if the Foundation programme is called something different from the major.
                    Leave blank if they are the same.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-4">
                <FormField
                    control={form.control}
                    name="country"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Country</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select a country" />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {countries.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                        <FormItem>
                        <FormLabel>Scholarship Type</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                            <SelectTrigger>
                                <SelectValue placeholder="Select category" />
                            </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="General">General</SelectItem>
                                <SelectItem value="MOHE">MOHE Approved</SelectItem>
                                <SelectItem value="Merit">Merit List</SelectItem>
                            </SelectContent>
                        </Select>
                        <FormDescription>Choose if MOHE or Merit.</FormDescription>
                        <FormMessage />
                        </FormItem>
                    )}
                />
            </div>

            <FormField
                control={form.control}
                name="ieltsScore"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>General IELTS Score</FormLabel>
                    <FormControl>
                        <Input type="number" step="0.5" {...field} />
                    </FormControl>
                    <FormDescription>
                      The school&apos;s overall requirement. Used for any entry level below that
                      does not set its own.
                    </FormDescription>
                    <FormMessage />
                    </FormItem>
                )}
            />

            <EntryRequirementsField />

            <FormField
                control={form.control}
                name="importantNote"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-red-600 font-bold">IMPORTANT Note (Red Visibility)</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Only for science background students" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
            />

            <FormField
                control={form.control}
                name="company"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company / Provider</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || ''}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select company" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {COMPANIES.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="schoolOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>School Order #</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="e.g. 1"
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                      />
                    </FormControl>
                    <FormDescription>Internal use only</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="majorOrder"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Major Order #</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="e.g. 1"
                        value={field.value ?? ''}
                        onChange={e => field.onChange(e.target.value === '' ? undefined : parseInt(e.target.value, 10))}
                      />
                    </FormControl>
                    <FormDescription>Internal use only</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Internal Notes (Muted)</FormLabel>
                    <FormControl>
                      <Textarea placeholder="Add any specific requirements or details..." {...field} className="min-h-[80px]" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
            />
            <FormField
                control={form.control}
                name="isAvailable"
                render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                        <FormLabel>Major is Available</FormLabel>
                        <FormMessage />
                    </div>
                    <FormControl>
                        <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                        />
                    </FormControl>
                </FormItem>
                )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
