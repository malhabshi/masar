'use client';

import { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, Invoice, InvoiceTemplate, InvoiceSavedItem } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateInvoice } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Loader2, Calculator, LayoutTemplate, Library, Coins, RefreshCw, User, UserPlus } from 'lucide-react';
import { useCollection } from '@/firebase/client';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const invoiceSchema = z.object({
  studentId: z.string().optional(),
  manualStudentName: z.string().optional(),
  manualStudentPhone: z.string().optional(),
  templateId: z.string().min(1, 'Please select a branding template.'),
  currency: z.literal('KWD').default('KWD'),
  secondaryCurrency: z.enum(['NONE', 'USD', 'GBP']).default('NONE'),
  conversionRate: z.coerce.number().min(0, 'Rate must be positive.').optional(),
  notes: z.string().optional(),
  discountAmount: z.coerce.number().min(0, 'Discount cannot be negative.').default(0),
  items: z.array(z.object({
    description: z.string().min(1, 'Description required.'),
    details: z.string().optional(),
    amount: z.coerce.number().min(0.01, 'Amount must be greater than 0.'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1.'),
  })).min(1, 'Add at least one item.'),
}).refine(data => data.studentId || (data.manualStudentName && data.manualStudentPhone), {
  message: "Select a student or enter name and phone.",
  path: ["studentId"]
});

interface EditInvoiceDialogProps {
  currentUser: AppUser;
  invoice: Invoice;
  students: Student[];
  templates: InvoiceTemplate[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditInvoiceDialog({ currentUser, invoice, students, templates, isOpen, onOpenChange }: EditInvoiceDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recipientType, setRecipientIdType] = useState<'system' | 'manual'>(invoice.studentId ? 'system' : 'manual');
  const { toast } = useToast();

  const { data: catalogItems } = useCollection<InvoiceSavedItem>(isOpen ? 'invoice_saved_items' : '');

  const form = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      studentId: invoice.studentId || '',
      manualStudentName: invoice.studentId ? '' : invoice.studentName,
      manualStudentPhone: invoice.studentId ? '' : invoice.studentPhone,
      templateId: invoice.templateId || '',
      currency: 'KWD',
      secondaryCurrency: invoice.secondaryCurrency || 'NONE',
      conversionRate: invoice.conversionRate,
      notes: invoice.notes || '',
      discountAmount: invoice.discountAmount || 0,
      items: invoice.items.map(item => ({
        description: item.description,
        details: item.details || '',
        amount: item.amount,
        quantity: item.quantity,
      })),
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        studentId: invoice.studentId || '',
        manualStudentName: invoice.studentId ? '' : invoice.studentName,
        manualStudentPhone: invoice.studentId ? '' : invoice.studentPhone,
        templateId: invoice.templateId || '',
        currency: 'KWD',
        secondaryCurrency: invoice.secondaryCurrency || 'NONE',
        conversionRate: invoice.conversionRate,
        notes: invoice.notes || '',
        discountAmount: invoice.discountAmount || 0,
        items: invoice.items.map(item => ({
          description: item.description,
          details: item.details || '',
          amount: item.amount,
          quantity: item.quantity,
        })),
      });
      setRecipientIdType(invoice.studentId ? 'system' : 'manual');
    }
  }, [isOpen, invoice, form]);

  const { fields, append, remove, update } = useFieldArray({
    control: form.control,
    name: "items",
  });

  const watchItems = form.watch('items');
  const watchDiscount = form.watch('discountAmount');
  const watchSecondary = form.watch('secondaryCurrency');
  const watchRate = form.watch('conversionRate');
  
  const discountValue = Number(watchDiscount) || 0;
  const subtotal = (watchItems || []).reduce((acc, item) => {
    const amount = Number(item.amount) || 0;
    const quantity = Number(item.quantity) || 0;
    return acc + (amount * quantity);
  }, 0);
  
  const total = Math.max(0, subtotal - discountValue);
  const secondaryTotal = watchSecondary !== 'NONE' && watchRate ? total * Number(watchRate) : null;

  const handleLoadFromCatalog = (index: number, savedItem: InvoiceSavedItem) => {
    update(index, {
      description: savedItem.name,
      details: savedItem.description || '',
      amount: savedItem.defaultAmount,
      quantity: 1,
    });
    toast({ title: 'Item Loaded', description: `Applied "${savedItem.name}" from catalog.` });
  };

  const onSubmit = async (values: z.infer<typeof invoiceSchema>) => {
    setIsSubmitting(true);
    
    let studentName = '';
    let studentPhone = '';
    let studentEmail = '';

    if (recipientType === 'system') {
      const selectedStudent = students.find(s => s.id === values.studentId);
      if (!selectedStudent) {
        toast({ variant: 'destructive', title: 'Error', description: 'Student not found.' });
        setIsSubmitting(false);
        return;
      }
      studentName = selectedStudent.name;
      studentPhone = selectedStudent.phone;
      studentEmail = selectedStudent.email;
    } else {
      studentName = values.manualStudentName || '';
      studentPhone = values.manualStudentPhone || '';
    }

    const updatedData = {
      studentId: recipientType === 'system' ? values.studentId : undefined,
      templateId: values.templateId,
      studentName,
      studentEmail,
      studentPhone,
      currency: 'KWD' as const,
      secondaryCurrency: values.secondaryCurrency === 'NONE' ? undefined : values.secondaryCurrency,
      conversionRate: values.secondaryCurrency !== 'NONE' ? Number(values.conversionRate) : undefined,
      items: values.items.map((item, idx) => ({ 
        id: `item-${idx}-${Date.now()}`,
        description: item.description,
        details: item.details,
        amount: Number(item.amount),
        quantity: Number(item.quantity)
      })),
      totalAmount: total,
      discountAmount: discountValue,
      notes: values.notes,
    };

    const result = await updateInvoice(currentUser.id, invoice.id, updatedData);

    if (result.success) {
      toast({ title: 'Invoice Updated', description: result.message });
      onOpenChange(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Invoice {invoice.invoiceNumber}</DialogTitle>
          <DialogDescription>Modify invoice details, items, or branding.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
            
            <div className="space-y-4">
              <Label className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Invoice Recipient</Label>
              <Tabs value={recipientType} onValueChange={(v) => setRecipientIdType(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="system" className="gap-2">
                    <User className="h-4 w-4" />
                    System Student
                  </TabsTrigger>
                  <TabsTrigger value="manual" className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Manual Entry
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="system" className="pt-4">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <FormField
                      control={form.control}
                      name="studentId"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Select Student</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
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
                        <FormItem className="md:col-span-2">
                          <FormLabel className="flex items-center gap-2">
                            <LayoutTemplate className="h-3 w-3" />
                            Select Branding
                          </FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Choose a template" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {templates.map(t => (
                                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="manual" className="pt-4 space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="manualStudentName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payer Name</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., Parent Name or Sponsor" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="manualStudentPhone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payer Phone</FormLabel>
                          <FormControl>
                            <Input placeholder="e.g., 55123456" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="templateId"
                    render={({ field }) => (
                      <FormItem className="w-full">
                        <FormLabel className="flex items-center gap-2">
                          <LayoutTemplate className="h-3 w-3" />
                          Select Branding
                        </FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Choose a template" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {templates.map(t => (
                              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </TabsContent>
              </Tabs>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border rounded-lg bg-primary/5 border-primary/20">
              <FormField
                control={form.control}
                name="currency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2 font-bold">
                      <Coins className="h-3 w-3" />
                      Base Currency
                    </FormLabel>
                    <Select disabled defaultValue="KWD">
                      <FormControl>
                        <SelectTrigger className="font-bold">
                          <SelectValue placeholder="KWD" />
                        </SelectTrigger>
                      </FormControl>
                    </Select>
                    <FormDescription>Invoices are in KWD.</FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="secondaryCurrency"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="flex items-center gap-2 text-accent font-bold">
                      <RefreshCw className="h-3 w-3" />
                      Secondary Currency
                    </FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="font-bold border-accent/20">
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="NONE">No conversion</SelectItem>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchSecondary !== 'NONE' && (
                <FormField
                  control={form.control}
                  name="conversionRate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="font-bold">Conversion Rate (1 KWD = ?)</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.0001" placeholder="e.g. 3.25" {...field} />
                      </FormControl>
                      <FormDescription>Rate to {watchSecondary}.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <FormLabel className="text-base font-bold">Line Items</FormLabel>
                <Button type="button" variant="outline" size="sm" onClick={() => append({ description: '', details: '', amount: 0, quantity: 1 })}>
                  <Plus className="h-4 w-4 mr-1" /> Add Custom Item
                </Button>
              </div>
              
              <div className="space-y-6">
                {fields.map((field, index) => (
                  <div key={field.id} className="p-4 border rounded-lg bg-muted/10 space-y-3 relative group">
                    <div className="flex gap-3 items-start">
                      <FormField
                        control={form.control}
                        name={`items.${index}.description`}
                        render={({ field }) => (
                          <FormItem className="flex-[3]">
                            <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground flex items-center justify-between">
                              Item Name
                              {catalogItems && catalogItems.length > 0 && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[9px] font-black bg-primary/10 text-primary hover:bg-primary/20">
                                      <Library className="h-2 w-2 mr-1" /> Quick Load
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuLabel className="text-[10px] uppercase">Service Catalog</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    {catalogItems.map(item => (
                                      <DropdownMenuItem key={item.id} onClick={() => handleLoadFromCatalog(index, item)} className="flex justify-between items-center cursor-pointer">
                                        <span className="font-bold truncate mr-2">{item.name}</span>
                                        <span className="text-[9px] font-mono opacity-60 shrink-0">{item.defaultAmount} KWD</span>
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </FormLabel>
                            <FormControl><Input placeholder="e.g., Application Fee" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.amount`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">Rate (KWD)</FormLabel>
                            <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name={`items.${index}.quantity`}
                        render={({ field }) => (
                          <FormItem className="w-20">
                            <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">Qty</FormLabel>
                            <FormControl><Input type="number" min="1" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="button" variant="ghost" size="icon" className="text-destructive mt-6" onClick={() => remove(index)} disabled={fields.length === 1}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <FormField
                      control={form.control}
                      name={`items.${index}.details`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-[10px] font-bold uppercase text-muted-foreground">Additional Details</FormLabel>
                          <FormControl><Input placeholder="e.g. University of Manchester" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                  <div className="text-right">
                    <div className="text-2xl font-black text-primary">{total.toFixed(2)} KWD</div>
                    {secondaryTotal !== null && (
                      <div className="text-sm font-bold text-accent">
                        ≈ {secondaryTotal.toFixed(2)} {watchSecondary}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Internal Notes / Payment Terms</FormLabel>
                  <FormControl><Textarea placeholder="e.g., Bank transfer details..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <DialogClose asChild><Button variant="outline" type="button">Cancel</Button></DialogClose>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
