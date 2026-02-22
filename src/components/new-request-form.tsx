'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser } from '@/hooks/use-user';
import type { Country, Student } from '@/lib/types';
import { firestore, setDocumentNonBlocking } from '@/firebase/client';
import { collection, doc } from 'firebase/firestore';
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
  FormDescription,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from '@/components/ui/card';
import { Checkbox } from './ui/checkbox';


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


export function NewRequestForm() {
    const { user: currentUser, isUserLoading } = useUser();
    const { toast } = useToast();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    const isForUnassigned = searchParams.get('unassigned') === 'true';

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

        const shouldBeAssigned = currentUser.role === 'employee' && !isForUnassigned;
        if (shouldBeAssigned && !currentUser.civilId) {
            toast({ variant: 'destructive', title: 'Account Incomplete', description: 'Your Civil ID is missing. Admin must add it before you can create assigned students.' });
            setIsSubmitting(false);
            return;
        }

        let finalTargetCountries = values.targetCountries;
        if (values.otherCountry && values.otherCountry.trim()) {
            finalTargetCountries = [...finalTargetCountries, values.otherCountry.trim()];
        }
        
        try {
            const studentsCollectionRef = collection(firestore, 'students');
            const newStudentDocRef = doc(studentsCollectionRef); // Create a reference with a new auto-generated ID

            const newStudentData: Student = {
                id: newStudentDocRef.id,
                name: values.studentName,
                email: values.studentEmail || '',
                phone: values.phone,
                employeeId: shouldBeAssigned ? currentUser.civilId! : null,
                ...(shouldBeAssigned && { isNewForEmployee: true }),
                avatarUrl: `https://picsum.photos/seed/s${Date.now()}/100/100`,
                applications: [],
                notes: values.notes ? [{ id: `note-${Date.now()}`, authorId: currentUser.id, content: values.notes, createdAt: new Date().toISOString() }] : [],
                documents: [],
                createdAt: new Date().toISOString(),
                createdBy: currentUser.id,
                targetCountries: finalTargetCountries as Country[],
                missingItems: [],
                pipelineStatus: 'none',
                profileCompletionStatus: {
                    submitUniversityApplication: false,
                    applyMoheScholarship: false,
                    submitKcoRequest: false,
                    receivedCasOrI20: false,
                    appliedForVisa: false,
                    documentsSubmittedToMohe: false,
                    readyToTravel: false,
                },
            };

            // Create the main student document
            setDocumentNonBlocking(newStudentDocRef, newStudentData);
            
            const returnTo = shouldBeAssigned ? '/applicants' : '/unassigned-students';
            router.push(`/student-added?studentName=${encodeURIComponent(values.studentName)}&returnTo=${returnTo}`);

        } catch (error) {
            console.error("Failed to create student:", error);
            toast({
                variant: "destructive",
                title: "Submission Failed",
                description: "Could not save the new student to the database. Please try again."
            });
        } finally {
            setIsSubmitting(false);
        }
    }

    if (isUserLoading) {
        return (
            <Card className="max-w-2xl mx-auto">
                <CardHeader>
                    <CardTitle>Add a New Student</CardTitle>
                    <CardDescription>Loading user information...</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
                </CardContent>
            </Card>
        );
    }
    
    if (!currentUser) {
       return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle>Unauthorized</CardTitle>
                <CardDescription>You must be logged in to add a new student.</CardDescription>
            </CardHeader>
        </Card>
       )
    }

    const descriptionText = currentUser.role === 'employee' && !isForUnassigned
        ? "Create a new student profile that will be automatically assigned to you."
        : "Create a new student profile that will be added to the 'Unassigned' list for an admin to assign.";


    return (
        <Card className="max-w-2xl mx-auto">
            <CardHeader>
                <CardTitle>Add a New Student</CardTitle>
                <CardDescription>
                  {descriptionText}
                </CardDescription>
            </CardHeader>
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                    <CardContent className="space-y-6">
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
                    </CardContent>
                    <CardFooter className="flex justify-end">
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Submit
                        </Button>
                    </CardFooter>
                </form>
            </Form>
        </Card>
    );
}
