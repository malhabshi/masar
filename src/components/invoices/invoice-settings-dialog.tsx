'use client';

import { useState, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { InvoiceTemplate, AppUser } from '@/lib/types';
import { saveInvoiceTemplate, deleteInvoiceTemplate } from '@/lib/actions';
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
import { Loader2, Plus, Trash2, Pencil, UploadCloud, GraduationCap } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const templateSchema = z.object({
  name: z.string().min(2, 'Template name required (e.g., Masar).'),
  companyName: z.string().min(2, 'Full company name required.'),
  companyAddress: z.string().min(5, 'Company address required.'),
  companyPhone: z.string().min(8, 'Company phone required.'),
  companyEmail: z.string().email('Valid email required.'),
});

interface InvoiceSettingsDialogProps {
  currentUser: AppUser;
  templates: InvoiceTemplate[];
  children: React.ReactNode;
}

export function InvoiceSettingsDialog({ currentUser, templates, children }: InvoiceSettingsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<z.infer<typeof templateSchema>>({
    resolver: zodResolver(templateSchema),
    defaultValues: {
      name: '',
      companyName: '',
      companyAddress: '',
      companyPhone: '',
      companyEmail: '',
    },
  });

  const handleEdit = (template: InvoiceTemplate) => {
    setIsEditing(template.id);
    setLogoUrl(template.logoUrl || null);
    form.reset({
      name: template.name,
      companyName: template.companyName,
      companyAddress: template.companyAddress,
      companyPhone: template.companyPhone,
      companyEmail: template.companyEmail,
    });
  };

  const handleAddNew = () => {
    setIsEditing('new');
    setLogoUrl(null);
    form.reset({
      name: '',
      companyName: '',
      companyAddress: '',
      companyPhone: '',
      companyEmail: '',
    });
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'shared'); // Reusing shared storage for invoice logos

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, // Assumes token is managed via middleware or similar
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

  const onSubmit = async (values: z.infer<typeof templateSchema>) => {
    setIsSubmitting(true);
    const id = isEditing === 'new' ? undefined : isEditing!;
    const result = await saveInvoiceTemplate(currentUser.id, {
      ...values,
      logoUrl: logoUrl || undefined,
    }, id);

    if (result.success) {
      toast({ title: 'Template Saved' });
      setIsEditing(null);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
    setIsSubmitting(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this branding profile?')) return;
    const result = await deleteInvoiceTemplate(currentUser.id, id);
    if (result.success) toast({ title: 'Template Deleted' });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Branding & Invoice Templates</DialogTitle>
          <DialogDescription>Manage company profiles like Masar and Mostajed for billing.</DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Template Identifier</FormLabel>
                        <FormControl><Input placeholder="e.g., Masar" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Legal Company Name</FormLabel>
                        <FormControl><Input placeholder="Masar Educational Services" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="space-y-2">
                    <FormLabel>Company Logo</FormLabel>
                    <div className="flex items-center gap-4 p-4 border rounded-lg bg-muted/10">
                      <div className="h-16 w-16 rounded-lg bg-white border flex items-center justify-center overflow-hidden">
                        {logoUrl ? (
                          <img src={logoUrl} alt="Logo Preview" className="max-h-full max-w-full object-contain" />
                        ) : (
                          <UploadCloud className="h-8 w-8 text-muted-foreground" />
                        )}
                      </div>
                      <div className="space-y-1">
                        <input type="file" ref={fileInputRef} onChange={handleLogoUpload} className="hidden" accept="image/*" />
                        <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isUploading}>
                          {isUploading ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : <Plus className="h-3 w-3 mr-2" />}
                          {logoUrl ? 'Change Logo' : 'Upload Logo'}
                        </Button>
                        <p className="text-[10px] text-muted-foreground">Clear background PNG recommended.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="companyEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Billing Email</FormLabel>
                        <FormControl><Input type="email" placeholder="billing@masar.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone</FormLabel>
                        <FormControl><Input placeholder="+965 1234 5678" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="companyAddress"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Office Address</FormLabel>
                        <FormControl><Textarea placeholder="Floor 12, Crystal Tower, Kuwait City" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsEditing(null)}>Cancel</Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Save Branding Profile
                </Button>
              </div>
            </form>
          </Form>
        ) : (
          <div className="space-y-6">
            <div className="flex justify-end">
              <Button onClick={handleAddNew} size="sm">
                <Plus className="h-4 w-4 mr-2" /> Add New Profile
              </Button>
            </div>
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Logo</TableHead>
                    <TableHead>Profile Name</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.length > 0 ? (
                    templates.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Avatar className="h-10 w-10 rounded-md border">
                            <AvatarImage src={t.logoUrl} className="object-contain" />
                            <AvatarFallback><GraduationCap className="h-5 w-5" /></AvatarFallback>
                          </Avatar>
                        </TableCell>
                        <TableCell className="font-bold">{t.name}</TableCell>
                        <TableCell>{t.companyName}</TableCell>
                        <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">
                          {t.companyEmail} • {t.companyPhone}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(t)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(t.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No branding profiles configured.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
