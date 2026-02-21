'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useUser } from '@/hooks/use-user';
import type { Country } from '@/lib/types';
import { useFirebase } from '@/firebase';
import { collection, doc, setDoc } from 'firebase/firestore';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const formSchema = z.object({
  studentName: z.string().min(2, { message: 'Student name must be at least 2 characters.' }),
  studentEmail: z.string().email().optional().or(z.literal('')),
  studentPhone: z.string().min(10, { message: 'Phone number must be at least 10 digits.' }).optional().or(z.literal('')),
  country: z.string().min(1, { message: 'Please select a country.' }),
  university: z.string().min(2, { message: 'University name must be at least 2 characters.' }),
  program: z.string().min(2, { message: 'Program name must be at least 2 characters.' }),
  intake: z.string().min(1, { message: 'Please select an intake.' }),
  agentName: z.string().optional(),
  notes: z.string().optional(),
  assignToMe: z.boolean().default(true),
});

interface NewRequestFormProps {
  countries: Country[];
  intakes: string[];
}

export default function NewRequestForm({ countries, intakes }: NewRequestFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useUser();
  const { toast } = useToast();
  const router = useRouter();
  const { firestore } = useFirebase();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      studentName: '',
      studentEmail: '',
      studentPhone: '',
      country: '',
      university: '',
      program: '',
      intake: '',
      agentName: '',
      notes: '',
      assignToMe: true,
    },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsSubmitting(true);
    
    try {
      // Create a new student document reference
      const studentsCollection = collection(firestore, 'students');
      const newStudentDocRef = doc(studentsCollection);
      
      const shouldBeAssigned = values.assignToMe && user?.civilId;
      
      const newStudentData = {
        id: newStudentDocRef.id,
        name: values.studentName,
        email: values.studentEmail || null,
        phone: values.studentPhone || null,
        employeeId: shouldBeAssigned ? user?.civilId : null,
        applications: [{
          country: values.country,
          university: values.university,
          program: values.program,
          intake: values.intake,
          agentName: values.agentName || null,
          status: 'New',
          submittedAt: new Date(),
        }],
        notes: values.notes ? [{
          id: crypto.randomUUID(),
          content: values.notes,
          createdAt: new Date(),
          createdBy: user?.id,
          type: 'employee'
        }] : [],
        documents: [],
        createdAt: new Date(),
        createdBy: user?.id,
        pipelineStatus: 'none',
      };

      // Create the main student document (non-blocking)
      setDoc(newStudentDocRef, newStudentData)
        .then(() => {
          const returnTo = shouldBeAssigned ? '/applicants' : '/unassigned-students';
          router.push(`/student-added?studentName=${encodeURIComponent(values.studentName)}&returnTo=${returnTo}`);
        })
        .catch((error) => {
          console.error("Failed to create student:", error);
          toast({
            variant: "destructive",
            title: "Submission Failed",
            description: "Could not save the new student to the database. Please try again."
          });
        })
        .finally(() => {
          setIsSubmitting(false);
        });

    } catch (error) {
      console.error("Failed to create student:", error);
      toast({
        variant: "destructive",
        title: "Submission Failed",
        description: "Could not save the new student to the database. Please try again."
      });
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Student Request</CardTitle>
        <CardDescription>
          Submit a new application for a student.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Student Information</h3>
              
              <FormField
                control={form.control}
                name="studentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Student Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="studentEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input placeholder="john@example.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="studentPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="+965 1234 5678" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Application Details</h3>
              
              <FormField
                control={form.control}
                name="country"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Country *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a country" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {countries.map((country) => (
                          <SelectItem key={country.code} value={country.code}>
                            {country.name}
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
                name="university"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>University *</FormLabel>
                    <FormControl>
                      <Input placeholder="University name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="program"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Program *</FormLabel>
                    <FormControl>
                      <Input placeholder="Program name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="intake"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Intake *</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select intake" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {intakes.map((intake) => (
                          <SelectItem key={intake} value={intake}>
                            {intake}
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
                name="agentName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Agent Name (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Agent name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <h3 className="text-lg font-medium">Additional Information</h3>
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Any additional notes" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="assignToMe"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>
                        Assign this student to me
                      </FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div>

            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Submit Request
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
