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
import { Loader2, PlusCircle } from 'lucide-react';
import type { ApprovedUniversity, Student } from '@/lib/types';
import { useCollection, useDoc, updateDocumentNonBlocking } from '@/firebase/client';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { useUser } from '@/hooks/use-user';

const formSchema = z.object({
  universityName: z.string().min(1, { message: 'Please select a university.' }),
  major: z.string().min(2, { message: 'Major must be at least 2 characters.' }),
});

interface AddApplicationDialogProps {
  studentId: string;
}

export function AddApplicationDialog({ studentId }: AddApplicationDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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
    }
  });

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

  async function onSubmit(values: z.infer<typeof formSchema>) {
    if (!student) return;

    setIsLoading(true);
    const university = universities.find(uni => uni.name === values.universityName);
    if (!university) {
      toast({ variant: 'destructive', title: 'Error', description: 'Selected university not found.' });
      setIsLoading(false);
      return;
    }
    
    try {
      // Server action
      const result = await addApplication(student.id, university.name, university.country, values.major, student.name, student.employeeId);
      
      if (result.success) {
        toast({ title: 'Application Added', description: result.message });
        setIsOpen(false);
        form.reset();
      } else if (result.message === 'DB not available') {
        // Fallback to client-side write if Firebase Admin isn't configured for local development
        const studentRef = doc(firestore, 'students', student.id);
        const newApplication = { university: university.name, country: university.country, major: values.major, status: 'Pending' as const, updatedAt: new Date().toISOString() };
        
        await updateDocumentNonBlocking(studentRef, { 
          applications: [...(student.applications || []), newApplication] 
        });
        
        toast({ title: 'Application Added (Local Fallback)', description: 'Added successfully. (Note: System tasks and WhatsApp notifications were bypassed).' });
        setIsOpen(false);
        form.reset();
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Application</DialogTitle>
          <DialogDescription>
            Select an approved university and specify the major for this application.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="universityName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>University</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select from available universities" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {availableUniversities.map(uni => (
                        <SelectItem key={uni.id} value={uni.name}>
                          {uni.name} ({uni.country})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
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
