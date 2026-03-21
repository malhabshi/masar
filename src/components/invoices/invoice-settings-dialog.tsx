'use client';

import { useState, useRef, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { InvoiceTemplate, InvoiceSavedItem } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { saveInvoiceTemplate, deleteInvoiceTemplate, saveInvoiceSavedItem, deleteInvoiceSavedItem } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';
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
import { Loader2, Plus, Trash2, Pencil, UploadCloud, GraduationCap, LayoutTemplate, Library } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection } from '@/firebase/client';

const templateSchema = z.object({
  name: z.string().min(2, 'Template name required (e.g., Masar).'),
  companyName: z.string().min(2, 'Full company name required.'),
  companyAddress: z.string().min(5, 'Company address required.'),
  companyPhone: z.string().min(8, 'Company phone required.'),
  companyEmail: z.string().email('Valid email required.'),
});

const itemSchema = z.object({
  name: z.string().min(2, 'Item name required.'),
  description: z.string().optional(),
  defaultAmount: z.coerce.number().min(0, 'Amount must be positive.'),
});

interface InvoiceSettingsDialogProps {
  currentUser: AppUser;
  templates: InvoiceTemplate[];
  children: React.ReactNode;
}

export function InvoiceSettingsDialog({ currentUser, templates, children }: InvoiceSettingsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('templates');
  
  // Template states
  const [isEditingTemplate, setIsEditingTemplate] = useState<string | null>(null);
  const [isSubmittingTemplate, setIsSubmittingTemplate] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  
  // Saved Item states
  const [isEditingItem, setIsEditingItem] = useState<string | null>(null);
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);

  const { toast } = useToast();
  const { auth: authUser } = useUser();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch items
  const { data: savedItems, isLoading: itemsLoading } = useCollection<InvoiceSavedItem>(isOpen ? 'invoice_saved_items' : '');

  const templateForm = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: { name: '', companyName: '', companyAddress: '', companyPhone: '', companyEmail: '' },
  });

  const itemForm = useForm<z.infer<typeof itemSchema>>({
    resolver: zodResolver(itemSchema),
    defaultValues: { name: '', description: '', defaultAmount: 0 },
  });

  const handleEditTemplate = (template: InvoiceTemplate) => {
    setIsEditingTemplate(template.id);
    setLogoUrl(template.logoUrl || null);
    templateForm.reset({
      name: template.name,
      companyName: template.companyName,
      companyAddress: template.companyAddress,
      companyPhone: template.companyPhone,
      companyEmail: template.companyEmail,
    });
  };

  const handleEditItem = (item: InvoiceSavedItem) => {
    setIsEditingItem(item.id);
    itemForm.reset({
      name: item.name,
      description: item.description || '',
      defaultAmount: item.defaultAmount,
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !authUser) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'shared');

    try {
      const token = await authUser.getIdToken();
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        setLogoUrl(result.document.url);
        toast({ title: 'Logo Uploaded' });
      } else {
        throw new Error(result.error);
      }
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Upload Failed', description: error.message });
    } finally {
      setIsUploading(false);
    }
  };

  const onSubmitTemplate = async (values: z.infer<typeof templateSchema>) => {
    setIsSubmittingTemplate(true);
    const id = isEditingTemplate === 'new' ? undefined : isEditingTemplate!;
    const result = await saveInvoiceTemplate(currentUser.id, {
      ...values,
      logoUrl: logoUrl || undefined,
    }, id);

    if (result.success) {
      toast({ title: 'Template Saved' });
      setIsEditingTemplate(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmittingTemplate(false);
  };

  const onSubmitItem = async (values: z.infer<typeof itemSchema>) => {
    setIsSubmittingItem(true);
    const id = isEditingItem === 'new' ? undefined : isEditingItem!;
    const result = await saveInvoiceSavedItem(currentUser.id, values, id);

    if (result.success) {
      toast({ title: 'Item Saved to Library' });
      setIsEditingItem(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmittingItem(false);
  };

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this branding profile?')) return;
    const result = await deleteInvoiceTemplate(currentUser.id, id);
    if (result.success) toast({ title: 'Template Deleted' });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
  };

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Remove this item from the library?')) return;
    const result = await deleteInvoiceSavedItem(currentUser.id, id);
    if (result.success) toast({ title: 'Item Removed' });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto p-0">
        <DialogHeader className="px-6 pt-6 pb-2 border-b bg-muted/5">
          <DialogTitle>Invoice Management Settings</DialogTitle>
          <DialogDescription>Configure your agency identities and standard service catalog.</DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6 py-4">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="templates" className="gap-2">
              <LayoutTemplate className="h-4 w-4" />
              Branding Profiles
            </TabsTrigger>
            <TabsTrigger value="items" className="gap-2">
              <Library className="h-4 w-4" />
              Item Library
            </TabsTrigger>
          </TabsList>

          <TabsContent value="templates" className="space-y-6">
            {isEditingTemplate ? (
              <Form {...templateForm}>
                <form onSubmit={templateForm.handleSubmit(onSubmitTemplate)} className="space-y-6 animate-in fade-in slide-in-from-top-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <FormField control={templateForm.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Profile Identity (e.g., Masar)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={templateForm.control} name="companyName" render={({ field }) => (
                        <FormItem><FormLabel>Legal Entity Name</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <div className="space-y-2">
                        <FormLabel>Company Logo</FormLabel>
                        <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/10">
                          <div className="h-16 w-16 rounded-lg bg-white border flex items-center justify-center overflow-hidden">
                            {logoUrl ? <img src={logoUrl} alt="Logo" className="max-h-full max-w-full object-contain" crossOrigin="anonymous" /> : <UploadCloud className="h-8 w-8 text-muted-foreground" />}
                          </div>
                          <div className="space-y-1">
                            <input type="file" ref={fileInputRef} onChange={handleLogoUpload} className="hidden" accept="image/*" />
                            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                              {isUploading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
                              {logoUrl ? 'Change Logo' : 'Upload Logo'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <FormField control={templateForm.control} name="companyEmail" render={({ field }) => (
                        <FormItem><FormLabel>Billing Email</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={templateForm.control} name="companyPhone" render={({ field }) => (
                        <FormItem><FormLabel>Contact Number</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={templateForm.control} name="companyAddress" render={({ field }) => (
                        <FormItem><FormLabel>Office Address</FormLabel><FormControl><Textarea {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 border-t pt-4">
                    <Button type="button" variant="ghost" onClick={() => setIsEditingTemplate(null)}>Cancel</Button>
                    <Button type="submit" disabled={isSubmittingTemplate}>
                      {isSubmittingTemplate && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Identity
                    </Button>
                  </div>
                </form>
              </Form>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-end"><Button onClick={() => { setIsEditingTemplate('new'); setLogoUrl(null); templateForm.reset({ name: '', companyName: '', companyAddress: '', companyPhone: '', companyEmail: '' }); }} size="sm" className="gap-2"><Plus className="h-4 w-4" /> New Identity</Button></div>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Identity</TableHead><TableHead>Contact</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {templates.length > 0 ? templates.map((t) => (
                        <TableRow key={t.id}>
                          <TableCell><div className="flex items-center gap-3"><Avatar className="h-8 w-8 rounded-md border p-1"><AvatarImage src={t.logoUrl} className="object-contain" crossOrigin="anonymous" /><AvatarFallback><GraduationCap className="h-4 w-4" /></AvatarFallback></Avatar><div><div className="font-bold">{t.name}</div><div className="text-[10px] text-muted-foreground">{t.companyName}</div></div></div></TableCell>
                          <TableCell className="text-[10px] text-muted-foreground"><div>{t.companyEmail}</div><div>{t.companyPhone}</div></TableCell>
                          <TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => handleEditTemplate(t)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteTemplate(t.id)}><Trash2 className="h-4 w-4" /></Button></div></TableCell>
                        </TableRow>
                      )) : <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No branding identities defined.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="items" className="space-y-6">
            {isEditingItem ? (
              <Form {...itemForm}>
                <form onSubmit={itemForm.handleSubmit(onSubmitItem)} className="space-y-6 animate-in fade-in slide-in-from-top-2">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <FormField control={itemForm.control} name="name" render={({ field }) => (
                        <FormItem><FormLabel>Service Name</FormLabel><FormControl><Input placeholder="e.g., UK Application Fee" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                      <FormField control={itemForm.control} name="defaultAmount" render={({ field }) => (
                        <FormItem><FormLabel>Standard Rate (KWD)</FormLabel><FormControl><Input type="number" step="0.01" {...field} /></FormControl><FormMessage /></FormItem>
                      )} />
                    </div>
                    <FormField control={itemForm.control} name="description" render={({ field }) => (
                      <FormItem><FormLabel>Standard Details / Subtitle</FormLabel><FormControl><Textarea placeholder="Details that appear under the item name by default..." className="h-[115px]" {...field} /></FormControl><FormMessage /></FormItem>
                    )} />
                  </div>
                  <div className="flex justify-end gap-2 border-t pt-4">
                    <Button type="button" variant="ghost" onClick={() => setIsEditingItem(null)}>Cancel</Button>
                    <Button type="submit" disabled={isSubmittingItem}>
                      {isSubmittingItem && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save to Catalog
                    </Button>
                  </div>
                </form>
              </Form>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-end"><Button onClick={() => { setIsEditingItem('new'); itemForm.reset({ name: '', description: '', defaultAmount: 0 }); }} size="sm" className="gap-2"><Plus className="h-4 w-4" /> Add Item to Catalog</Button></div>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Service Name</TableHead><TableHead>Standard Rate</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {itemsLoading ? <TableRow><TableCell colSpan={3} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell></TableRow> : savedItems && savedItems.length > 0 ? savedItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><div><div className="font-bold">{item.name}</div><div className="text-[10px] text-muted-foreground truncate max-w-[300px]">{item.description || 'No default details'}</div></div></TableCell>
                          <TableCell className="font-mono font-bold">{item.defaultAmount.toFixed(2)} KWD</TableCell>
                          <TableCell className="text-right"><div className="flex justify-end gap-1"><Button variant="ghost" size="icon" onClick={() => handleEditItem(item)}><Pencil className="h-4 w-4" /></Button><Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDeleteItem(item.id)}><Trash2 className="h-4 w-4" /></Button></div></TableCell>
                        </TableRow>
                      )) : <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Library is empty. Add standard services here.</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="p-6 border-t bg-muted/5">
          <DialogClose asChild><Button variant="outline">Done</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
