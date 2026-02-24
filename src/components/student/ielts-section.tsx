'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, IeltsScore } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentIELTS } from '@/lib/actions';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, FilePenLine } from 'lucide-react';
import { Badge } from '../ui/badge';


const ieltsFormSchema = z.object({
  overall: z.coerce.number().min(0, "Score must be at least 0.").max(9, "Score must be at most 9."),
  listening: z.coerce.number().min(0).max(9).optional(),
  reading: z.coerce.number().min(0).max(9).optional(),
  writing: z.coerce.number().min(0).max(9).optional(),
  speaking: z.coerce.number().min(0).max(9).optional(),
});


interface IeltsSectionProps {
  student: Student;
  currentUser: AppUser;
}

export function IeltsSection({ student, currentUser }: IeltsSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const canEdit = currentUser.role === 'employee';
  const ieltsScore = student.ielts;

  const form = useForm<z.infer<typeof ieltsFormSchema>>({
    resolver: zodResolver(ieltsFormSchema),
    defaultValues: {
      overall: ieltsScore?.overall ?? 0,
      listening: ieltsScore?.listening ?? 0,
      reading: ieltsScore?.reading ?? 0,
      writing: ieltsScore?.writing ?? 0,
      speaking: ieltsScore?.speaking ?? 0,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        overall: ieltsScore?.overall ?? 0,
        listening: ieltsScore?.listening ?? 0,
        reading: ieltsScore?.reading ?? 0,
        writing: ieltsScore?.writing ?? 0,
        speaking: ieltsScore?.speaking ?? 0,
      });
    }
  }, [isOpen, ieltsScore, form]);

  async function onSubmit(values: z.infer<typeof ieltsFormSchema>) {
    setIsLoading(true);
    
    const ieltsData: Partial<IeltsScore> = {
      overall: values.overall,
      listening: values.listening,
      reading: values.reading,
      writing: values.writing,
      speaking: values.speaking,
    }

    const result = await updateStudentIELTS(student.id, ieltsData, currentUser.id);

    if (result.success) {
        toast({ title: 'IELTS Score Updated', description: result.message });
        setIsOpen(false);
    } else {
        toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }

    setIsLoading(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
            <CardTitle>IELTS Score</CardTitle>
            {ieltsScore && <CardDescription>Last updated score details.</CardDescription>}
        </div>
        {canEdit && (
             <Dialog open={isOpen} onOpenChange={setIsOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" size="icon">
                        <FilePenLine className="h-4 w-4" />
                        <span className="sr-only">Edit IELTS Score</span>
                    </Button>
                </DialogTrigger>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit IELTS Score</DialogTitle>
                        <DialogDescription>Update the student's IELTS score details. Set to 0 if not applicable.</DialogDescription>
                    </DialogHeader>
                     <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                           <FormField
                                control={form.control}
                                name="overall"
                                render={({ field }) => (
                                    <FormItem>
                                    <FormLabel>Overall Band Score</FormLabel>
                                    <FormControl>
                                        <Input type="number" step="0.5" min="0" max="9" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                    </FormItem>
                                )}
                            />
                             <div className="grid grid-cols-2 gap-4">
                                <FormField control={form.control} name="listening" render={({ field }) => (
                                    <FormItem><FormLabel>Listening</FormLabel><FormControl><Input type="number" step="0.5" min="0" max="9" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name="reading" render={({ field }) => (
                                    <FormItem><FormLabel>Reading</FormLabel><FormControl><Input type="number" step="0.5" min="0" max="9" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name="writing" render={({ field }) => (
                                    <FormItem><FormLabel>Writing</FormLabel><FormControl><Input type="number" step="0.5" min="0" max="9" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                                <FormField control={form.control} name="speaking" render={({ field }) => (
                                    <FormItem><FormLabel>Speaking</FormLabel><FormControl><Input type="number" step="0.5" min="0" max="9" {...field} /></FormControl><FormMessage /></FormItem>
                                )}/>
                             </div>
                            <DialogFooter>
                                <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
                                <Button type="submit" disabled={isLoading}>
                                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Score
                                </Button>
                            </DialogFooter>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {ieltsScore ? (
            <div className="flex flex-wrap gap-4 items-center">
                <div className="text-center p-4 rounded-lg bg-primary/10">
                    <div className="text-3xl font-bold text-primary">{ieltsScore.overall.toFixed(1)}</div>
                    <div className="text-sm text-muted-foreground">Overall</div>
                </div>
                <div className="flex-1 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                    <div><span className="font-medium">Listening:</span> <Badge variant="secondary">{ieltsScore.listening?.toFixed(1) ?? 'N/A'}</Badge></div>
                    <div><span className="font-medium">Reading:</span> <Badge variant="secondary">{ieltsScore.reading?.toFixed(1) ?? 'N/A'}</Badge></div>
                    <div><span className="font-medium">Writing:</span> <Badge variant="secondary">{ieltsScore.writing?.toFixed(1) ?? 'N/A'}</Badge></div>
                    <div><span className="font-medium">Speaking:</span> <Badge variant="secondary">{ieltsScore.speaking?.toFixed(1) ?? 'N/A'}</Badge></div>
                </div>
            </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No IELTS score has been added yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
