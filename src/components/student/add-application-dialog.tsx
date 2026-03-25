'use client';

import { useState, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { addApplication } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Search, ChevronsUpDown, Check } from 'lucide-react';
import type { ApprovedUniversity, Student } from '@/lib/types';
import { useCollection, useDoc, updateDocumentNonBlocking } from '@/firebase/client';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { useUser } from '@/hooks/use-user';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

const formSchema = z.object({
  universityName: z.string().min(1, { message: 'Please enter a university name.' }),
  major: z.string().min(2, { message: 'Major must be at least 2 characters.' }),
  country: z.string().min(1, { message: 'Please select a country.' }),
  isManual: z.boolean().default(false),
});

interface AddApplicationDialogProps {
  studentId: string;
}

export function AddApplicationDialog({ studentId }: AddApplicationDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  
  const { toast } = useToast();
  const { user } = useUser();

  const { data: student } = useDoc<Student>('students', studentId);
  const { data: universitiesData } = useCollection<ApprovedUniversity>(user ? 'approved_universities' : '');
  
  const universities = useMemo(() => universitiesData || [], [universitiesData]);
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      universityName: '',
      major: '',
      country: 'UK',
      isManual: false,
    }
  });

  const isManual = form.watch('isManual');

  const availableUniversities = useMemo(() => {
    if(!universities) return [];
    
    // Filter out universities already in the student's applications list
    const existingUniNames = new Set((student?.applications || []).map(a => a.university));
    
    const available = universities.filter(uni => uni.isAvailable && !existingUniNames.has(uni.name));
    const unique: ApprovedUniversity[] = [];
    const seen = new Set<string>();
    for (const uni of available) {
        if (!seen.has(uni.name)) {
            seen.add(uni.name);
            unique.push(uni);
        }
    }
    return unique;
  }, [universities, student?.applications]);

  const filteredUniversities = useMemo(() => {
    if (!search.trim()) return availableUniversities;
    return availableUniversities.filter(uni => 
      uni.name.toLowerCase().includes(search.toLowerCase()) ||
      uni.country.toLowerCase().includes(search.toLowerCase())
    );
  }, [availableUniversities, search]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!student) return;

    setIsLoading(true);
    const country = values.country;
    
    try {
      // Server action
      const result = await addApplication(student.id, values.universityName, country, values.major, student.name, student.employeeId);
      
      if (result.success) {
        toast({ title: 'Application Added', description: result.message });
        setIsOpen(false);
        form.reset();
        setSearch('');
      } else if (result.message === 'DB not available') {
        const studentRef = doc(firestore, 'students', student.id);
        const newApplication = { university: values.universityName, country: country as any, major: values.major, status: 'Pending' as const, updatedAt: new Date().toISOString() };
        
        await updateDocumentNonBlocking(studentRef, { 
          applications: [...(student.applications || []), newApplication] 
        });
        
        toast({ title: 'Application Added (Local Fallback)', description: 'Added successfully.' });
        setIsOpen(false);
        form.reset();
        setSearch('');
      } else {
        toast({ variant: 'destructive', title: 'Failed to add application', description: result.message });
      }
    } catch(err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message || 'Unknown error occurred.' });
    }
    setIsLoading(false);
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Application
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add New Application</DialogTitle>
          <DialogDescription>
            {isManual ? 'Enter school details manually.' : 'Search and select an approved university.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4 p-2 bg-muted/30 rounded-lg border border-dashed">
          <label className="text-xs font-medium cursor-pointer flex-1" htmlFor="manual-mode">
            School not in the list? Enter manually
          </label>
          <input 
            type="checkbox" 
            id="manual-mode"
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            checked={isManual}
            onChange={(e) => {
              const checked = e.target.checked;
              form.setValue('isManual', checked);
              if (!checked) {
                form.setValue('universityName', '');
                form.setValue('country', 'UK');
              }
            }}
          />
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            {isManual ? (
              <>
                <FormField
                  control={form.control}
                  name="universityName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>University Name</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter full university name..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="UK">UK</SelectItem>
                          <SelectItem value="USA">USA</SelectItem>
                          <SelectItem value="Australia">Australia</SelectItem>
                          <SelectItem value="New Zealand">New Zealand</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            ) : (
              <FormField
                control={form.control}
                name="universityName"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Approved University</FormLabel>
                    <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            role="combobox"
                            className={cn(
                              "w-full justify-between text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value
                              ? availableUniversities.find(
                                  (uni) => uni.name === field.value
                                )?.name
                              : "Search university..."}
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <div className="flex items-center border-b px-3 py-2 bg-muted/50">
                          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50 text-primary" />
                          <Input
                            placeholder="Type name or country..."
                            className="h-8 border-none bg-transparent focus-visible:ring-0 px-0 shadow-none focus-visible:ring-offset-0"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                        <ScrollArea className="h-[250px]">
                          <div className="p-1">
                            {filteredUniversities.length === 0 ? (
                              <div className="p-4 text-center text-sm text-muted-foreground italic">
                                No matching universities found.
                              </div>
                            ) : (
                              filteredUniversities.map((uni) => (
                                <button
                                  key={uni.id}
                                  type="button"
                                  className={cn(
                                    "w-full flex items-center justify-between px-3 py-2 text-sm rounded-md transition-colors",
                                    "hover:bg-primary/10 text-left",
                                    field.value === uni.name && "bg-primary/5 text-primary font-bold"
                                  )}
                                  onClick={() => {
                                    form.setValue("universityName", uni.name);
                                    form.setValue("country", uni.country);
                                    setPopoverOpen(false);
                                    setSearch('');
                                  }}
                                >
                                  <span>{uni.name} ({uni.country})</span>
                                  {field.value === uni.name && (
                                    <Check className="h-4 w-4" />
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        </ScrollArea>
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name="major"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Major</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Computer Science" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Add Application'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
