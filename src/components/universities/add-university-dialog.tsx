
'use client';

import { useState } from 'react';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Loader2 } from 'lucide-react';
import type { ApprovedUniversity, Country } from '@/lib/types';

const ENTRY_LEVELS = ['Foundation', 'First Year', 'Bachelor Degree'];

const formSchema = z.object({
  name: z.string().min(3, { message: 'University name is required.' }),
  major: z.string().min(3, { message: 'Major is required.' }),
  country: z.enum(['UK', 'USA', 'Australia', 'New Zealand']),
  category: z.enum(['MOHE', 'Merit', 'General']),
  entryLevels: z.array(z.string()).default([]),
  ieltsScore: z.coerce.number().min(0).max(9),
  isAvailable: z.boolean().default(false),
  notes: z.string().optional(),
  importantNote: z.string().optional(),
});

interface AddUniversityDialogProps {
  children: React.ReactNode;
  onAddUniversity: (university: Omit<ApprovedUniversity, 'id'>) => void;
}

export function AddUniversityDialog({ children, onAddUniversity }: AddUniversityDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      major: '',
      country: 'UK',
      category: 'General',
      entryLevels: [],
      ieltsScore: 6.5,
      isAvailable: true,
      notes: '',
      importantNote: '',
    },
  });

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    onAddUniversity(values);
    setIsLoading(false);
    setIsOpen(false);
    form.reset();
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Approved University</DialogTitle>
          <DialogDescription>
            Add a new university to the list of approved application destinations.
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
              name="entryLevels"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel>Allowed Entry Levels</FormLabel>
                    <FormDescription>Select one or more available entry points.</FormDescription>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {ENTRY_LEVELS.map((level) => (
                      <FormField
                        key={level}
                        control={form.control}
                        name="entryLevels"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={level}
                              className="flex flex-row items-start space-x-3 space-y-0 p-2 border rounded-md hover:bg-muted/50 cursor-pointer"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(level)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...field.value, level])
                                      : field.onChange(
                                          field.value?.filter(
                                            (value) => value !== level
                                          )
                                        )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="text-sm font-normal cursor-pointer w-full">
                                {level}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
                control={form.control}
                name="ieltsScore"
                render={({ field }) => (
                    <FormItem>
                    <FormLabel>Required IELTS Score</FormLabel>
                    <FormControl>
                        <Input type="number" step="0.5" {...field} />
                    </FormControl>
                    <FormMessage />
                    </FormItem>
                )}
            />

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
                Add University
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
