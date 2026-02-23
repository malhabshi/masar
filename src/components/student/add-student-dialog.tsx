'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import type { Country } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '../ui/checkbox';
import { createStudent } from '@/lib/actions';


const formSchema = z.object({
  studentName: z.string().min(2, {
    message: 'Student name must be at least 2 characters.',
  }),
  studentEmail: z.string().email({ message: "Please enter a valid email address." }).optional().or(z.literal('')),
  phone: z.string().min(8, {
    message: 'Please enter a valid phone number.',
  }),
  targetCountries: z.array(z.string()).default([]),
  otherCountry: z.string().optional(),
  notes: z.string().optional(),
}).refine(data => {
    return data.targetCountries.length > 0 || (!!data.otherCountry && data.otherCountry.trim() !== '');
}, {
  message: "Please select at least one target country or specify 'Other'.",
  path: ['targetCountries'],
});

export function AddStudentDialog() {
    const { user: currentUser } = useUser();
    const router = useRouter();
    const { toast } = useToast();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    
    const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            studentName: '',
            studentEmail: '',
            phone: '',
            notes: '',
            targetCountries: [],
            otherCountry: '',
        },
    });


    async function onSubmit(values: z.infer<typeof formSchema>) {
        setIsSubmitting(true);

        if (!currentUser) {
            toast({ variant: 'destructive', title: 'Error', description: 'You must be logged in to create a student.' });
            setIsSubmitting(false);
            return;
        }

        try {
            const result = await createStudent(
                values,
                currentUser.id,
                currentUser.role,
                currentUser.civilId
            );

            if (result.success && result.studentName) {
                const shouldBeAssigned = currentUser.role === 'employee';
                const returnTo = shouldBeAssigned ? '/applicants' : '/unassigned-students';
                router.push(`/student-added?studentName=${encodeURIComponent(result.studentName)}&returnTo=${returnTo}`);
                setIsOpen(false);
                form.reset();
            } else {
                 toast({
                    variant: "destructive",
                    title: "Submission Failed",
                    description: result.message || "An unexpected error occurred."
                });
            }
        } catch (error) {
            console.error("Failed to create student:", error);
            toast({
                variant: "destructive",
                title: "Submission Failed",
                description: "Could not save the new student. Please try again."
            });
        } finally {
            setIsSubmitting(false);
        }
    }
    
    const descriptionText = currentUser?.role === 'employee'
        ? "Create a new student profile that will be automatically assigned to you."
        : "Create a new student profile that will be added to the 'Unassigned' list for an admin to assign.";


    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add New Student
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Add a New Student</DialogTitle>
                    <DialogDescription>
                      {descriptionText}
                    </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)}>
                        <div className="space-y-6 py-4">
                            <FormField
                            control={form.control}
                            name="studentName"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Student Full Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="e.g., Jane Doe" {...field} />
                                </FormControl>
                                <FormMessage />
                                </FormItem>
                            )}
                            />
                            
                            <FormField
                                control={form.control}
                                name="studentEmail"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Student Email Address (Optional)</FormLabel>
                                    <FormControl>
                                        <Input type="email" placeholder="jane.doe@example.com" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                            control={form.control}
                            name="phone"
                            render={({ field }) => (
                                <FormItem>
                                <FormLabel>Phone Number</FormLabel>
                                <FormControl>
                                    <Input type="tel" placeholder="e.g., 55123456" {...field} />
                                </FormControl>
                                <FormDescription>
                                    Kuwait country code (+965) is assumed.
                                </FormDescription>
                                <FormMessage />
                                </FormItem>
                            )}
                            />

                            <FormField
                                control={form.control}
                                name="targetCountries"
                                render={({ field }) => (
                                    <FormItem>
                                    <div className="mb-4">
                                        <FormLabel>Target Countries</FormLabel>
                                        <FormDescription>
                                            Select one or more countries the student is interested in.
                                        </FormDescription>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                    {countries.map((country) => (
                                        <FormItem
                                            key={country}
                                            className="flex flex-row items-start space-x-3 space-y-0"
                                        >
                                            <FormControl>
                                            <Checkbox
                                                checked={field.value?.includes(country)}
                                                onCheckedChange={(checked) => {
                                                return checked
                                                    ? field.onChange([...(field.value || []), country])
                                                    : field.onChange(
                                                        field.value?.filter(
                                                        (value) => value !== country
                                                        )
                                                    )
                                                }}
                                            />
                                            </FormControl>
                                            <FormLabel className="font-normal">
                                            {country}
                                            </FormLabel>
                                        </FormItem>
                                    ))}
                                    </div>
                                    <FormField
                                        control={form.control}
                                        name="otherCountry"
                                        render={({ field: otherField }) => (
                                            <FormItem className="mt-4">
                                                <FormLabel>Other</FormLabel>
                                                <FormControl>
                                                    <Input placeholder="Specify other country" {...otherField} />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="notes"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Initial Notes</FormLabel>
                                    <FormControl>
                                        <Textarea
                                        placeholder="Any initial notes about the student or their preferences..."
                                        {...field}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                        <DialogFooter>
                           <DialogClose asChild>
                            <Button variant="outline" type="button">Cancel</Button>
                           </DialogClose>
                            <Button type="submit" disabled={isSubmitting}>
                                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Create Student
                            </Button>
                        </DialogFooter>
                    </form>
                </Form>
            </DialogContent>
        </Dialog>
    );
}
