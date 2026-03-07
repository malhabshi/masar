'use client';

import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, AppUser, InvoiceItem, InvoiceTemplate } from '@/lib/types';
import { createInvoice } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, Calculator, LayoutTemplate, Tag } from 'lucide-react';

const invoiceSchema = z.object({
  studentId: z.string().min(1, 'Please select a student.'),
  templateId: z.string().min(1, 'Please select a branding template.'),
  notes: z.string().optional(),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative.').default(0),
  items: z.array(z.object({
    description: z.string().min(1, 'Description required.'),
    amount: z.coerce.number().min(0.01, 'Amount must be greater than 0.'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
  })).min(1, 'Add at least one item.'),
});

interface CreateInvoiceDialogProps {
  currentUser: AppUser;
  students: Student[];
  templates: InvoiceTemplate[];
  children: React.ReactNode;
}

export function CreateInvoiceDialog({ currentUser, students, templates, children }: CreateInvoiceDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      studentId: '',
      templateId: templates.length === 1 ? templates[0].id : '',
      notes: '',
      discountAmount: 0,
      items: [{ description: '', amount: 0, quantity: 1 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchItems = form.watch('items');
  const watchDiscount = form.watch('discountAmount');
  
  // Ensure we treat values as numbers during the calculation phase
  const discountValue = Number(watchDiscount) || 0;
  const subtotal = watchItems.reduce((acc, item) => {
    const amount = Number(item.amount) || 0;
    const quantity = Number(item.quantity) || 0;
    return acc + (amount * quantity);
  }, 0);
  
  const total = Math.max(0, subtotal - discountValue);

  const onSubmit = async (values: z.infer<typeof invoiceSchema>) => {
    setIsSubmitting(true);
    const selectedStudent = students.find(s => s.id === values.studentId);
    
    if (!selectedStudent) {
      toast({ variant: 'destructive', title: 'Error', description: 'Student not found.' });
      setIsSubmitting(false);
      return;
    }

    const invoiceData = {
      studentId: values.studentId,
      templateId: values.templateId,
      studentName: selectedStudent.name,
      studentEmail: selectedStudent.email,
      studentPhone: selectedStudent.phone,
      items: values.items.map((item, idx) => ({ 
        id: `item-${idx}-${Date.now()}`,
        description: item.description,
        amount: Number(item.amount),
        quantity: Number(item.quantity)
      })),
      totalAmount: total,
      discountAmount: discountValue,
      status: 'unpaid' as const,
      notes: values.notes,
    };

    const result = await createInvoice(currentUser.id, invoiceData);

    if (result.success) {
      toast({ title: 'Invoice Created', description: result.message });
      setIsOpen(false);
      form.reset();
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Invoice</DialogTitle>
          <DialogDescription>Bill a student for agency services or exam registrations.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="studentId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Select Student</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Search students..." />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {students.map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name} ({s.phone})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="templateId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <LayoutTemplate className="h-3 w-3" />
                      Select Branding
                    </FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a template (Masar/Mostajed)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {templates.map(t => (
                          <SelectItem key={t.id} value={t.id}>{t.name} ({t.companyName})</SelectItem>
                        ))}
                        {templates.length === 0 && (
                          <SelectItem value="none" disabled>No templates found. Go to Settings.</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base font-bold">Line Items</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={() => append({ description: '', amount: 0, quantity: 1 })}>
                  <Plus className="h-4 w-4 mr-1" /> Add Item
                </Button>
              </div>
              
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={field.id} className="flex gap-3 items-start animate-in fade-in slide-in-from-top-1">
                    <FormField
                      control={form.control}
                      name={`items.${index}.description`}
                      render={({ field }) => (
                        <FormItem className="flex-[3]">
                          <FormControl><Input placeholder="Service description..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.amount`}
                      render={({ field }) => (
                        <FormItem className="flex-1">
                          <FormControl><Input type="number" step="0.01" placeholder="Amount" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name={`items.${index}.quantity`}
                      render={({ field }) => (
                        <FormItem className="w-20">
                          <FormControl><Input type="number" min="1" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="button" variant="ghost" size="icon" className="text-destructive mt-0.5" onClick={() => remove(index)} disabled={fields.length === 1}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end pt-4 border-t">
              <FormField
                control={form.control}
                name="discountAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2">
                      <Tag className="h-3 w-3" />
                      Discount Amount (KWD)
                    </FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min="0" placeholder="0.00" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="bg-muted/50 p-4 rounded-lg flex flex-col gap-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{subtotal.toFixed(2)} KWD</span>
                </div>
                {discountValue > 0 && (
                  <div className="flex justify-between text-xs text-destructive">
                    <span>Discount</span>
                    <span>-{discountValue.toFixed(2)} KWD</span>
                  </div>
                )}
                <div className="flex items-center justify-between border-t pt-2 mt-1">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calculator className="h-4 w-4" />
                    <span className="text-sm font-bold uppercase tracking-widest">Total</span>
                  </div>
                  <div className="text-2xl font-black text-primary">{total.toFixed(2)} KWD</div>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal Notes / Payment Terms</FormLabel>
                  <FormControl><Textarea placeholder="e.g., Bank transfer details or payment deadline..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate Invoice
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}