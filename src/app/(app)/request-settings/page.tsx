'use client';

import { useState, useMemo, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import { useCollection, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { RequestType, User } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

// UI components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, PlusCircle, Trash2, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';

const requestTypeSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters.'),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
  defaultRecipientId: z.string().min(1, 'A default recipient is required.'),
  requiredFields: z.string().optional(),
  isActive: z.boolean().default(true),
});

function RequestTypeDialog({
  isOpen,
  setIsOpen,
  requestType,
  onSubmit,
  users,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  requestType?: RequestType;
  onSubmit: (values: z.infer<typeof requestTypeSchema>) => void;
  users: User[];
}) {
  const form = useForm<z.infer<typeof requestTypeSchema>>({
    resolver: zodResolver(requestTypeSchema),
    defaultValues: {
      name: requestType?.name || '',
      description: requestType?.description || '',
      defaultRecipientId: requestType?.defaultRecipientId || 'admins',
      requiredFields: requestType?.requiredFields?.join('\n') || '',
      isActive: requestType?.isActive ?? true,
    },
  });

  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: requestType?.name || '',
        description: requestType?.description || '',
        defaultRecipientId: requestType?.defaultRecipientId || 'admins',
        requiredFields: requestType?.requiredFields?.join('\n') || '',
        isActive: requestType?.isActive ?? true,
      });
    }
  }, [isOpen, form, requestType]);

  const handleSubmit = (values: z.infer<typeof requestTypeSchema>) => {
    onSubmit(values);
    setIsOpen(false);
  };

  const recipientOptions = useMemo(() => {
    const adminUsers = users.filter(u => u.role === 'admin');
    return [
      { id: 'admins', name: 'All Admins (Group)', role: 'admin' },
      ...adminUsers,
    ];
  }, [users]);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{requestType ? 'Edit' : 'Add'} Request Type</DialogTitle>
          <DialogDescription>Define a type of request an employee can make.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="e.g., Document Request" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea placeholder="Explain what this request is for." {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="defaultRecipientId" render={({ field }) => (
              <FormItem><FormLabel>Default Recipient</FormLabel><Select onValueChange={field.onChange} defaultValue={field.value}><FormControl><SelectTrigger><SelectValue placeholder="Select a default recipient" /></SelectTrigger></FormControl><SelectContent>{recipientOptions.map(u => (<SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>))}</SelectContent></Select><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="requiredFields" render={({ field }) => (
              <FormItem><FormLabel>Required Fields (Optional)</FormLabel><FormControl><Textarea placeholder="One field per line, e.g.,&#10;Student ID&#10;Document Type" {...field} /></FormControl><FormDescription>List any fields that must be filled out for this request type.</FormDescription><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="isActive" render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm"><div className="space-y-0.5"><FormLabel>Active</FormLabel><FormDescription>Inactive types won't be available for new requests.</FormDescription></div><FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl></FormItem>
            )} />
            <DialogFooter>
                <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function RequestSettingsPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { users, usersLoading } = useUsers();
    const { toast } = useToast();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRequestType, setEditingRequestType] = useState<RequestType | undefined>(undefined);

    const { data: requestTypes, isLoading: requestTypesAreLoading } = useCollection<RequestType>('request_types');
    
    const isLoading = isUserLoading || requestTypesAreLoading || usersLoading;
    const canManage = currentUser?.role === 'admin';

    const handleAddOrUpdate = (values: z.infer<typeof requestTypeSchema>) => {
        const requestTypesCollection = collection(firestore, 'request_types');
        
        const requestTypeData = {
            ...values,
            requiredFields: values.requiredFields ? values.requiredFields.split('\n').filter(Boolean) : [],
        };

        if (editingRequestType) {
            const docRef = doc(firestore, 'request_types', editingRequestType.id);
            updateDocumentNonBlocking(docRef, requestTypeData);
            toast({ title: 'Success', description: 'Request type updated.' });
        } else {
            addDocumentNonBlocking(requestTypesCollection, requestTypeData);
            toast({ title: 'Success', description: 'New request type added.' });
        }
        setEditingRequestType(undefined);
    };

    const handleDelete = (requestTypeId: string) => {
        const docRef = doc(firestore, 'request_types', requestTypeId);
        deleteDocumentNonBlocking(docRef);
        toast({ title: 'Success', description: 'Request type deleted.' });
    };
    
    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }
    
    if (!currentUser || !['admin', 'department'].includes(currentUser.role)) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to view this page.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>Request Settings</CardTitle>
                        <CardDescription>
                            Manage the types of requests employees can make (e.g., "Request Transfer", "Report Inactivity").
                        </CardDescription>
                    </div>
                    {canManage && (
                        <Button onClick={() => { setEditingRequestType(undefined); setIsDialogOpen(true); }}>
                            <PlusCircle className="mr-2 h-4 w-4" />
                            Add Request Type
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {requestTypes && requestTypes.length > 0 ? (
                            requestTypes.map((rt) => (
                                <Card key={rt.id}>
                                    <CardHeader className="py-4">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <CardTitle className="text-base flex items-center gap-2">
                                                    {rt.name}
                                                    {rt.isActive ? <CheckCircle className="h-4 w-4 text-green-500" /> : <XCircle className="h-4 w-4 text-red-500" />}
                                                </CardTitle>
                                                <CardDescription>{rt.description}</CardDescription>
                                            </div>
                                            {canManage && (
                                                <div className="flex gap-2">
                                                    <Button variant="ghost" size="icon" onClick={() => { setEditingRequestType(rt); setIsDialogOpen(true); }}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader><AlertDialogTitle>Delete Request Type</AlertDialogTitle><AlertDialogDescription>Are you sure you want to delete this request type? This action cannot be undone.</AlertDialogDescription></AlertDialogHeader>
                                                            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDelete(rt.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            )}
                                        </div>
                                    </CardHeader>
                                </Card>
                            ))
                        ) : (
                            <p className="text-center text-muted-foreground py-8">No request types configured.</p>
                        )}
                    </div>
                </CardContent>
            </Card>
            {canManage && (
                <RequestTypeDialog
                    isOpen={isDialogOpen}
                    setIsOpen={setIsDialogOpen}
                    requestType={editingRequestType}
                    onSubmit={handleAddOrUpdate}
                    users={users}
                />
            )}
        </>
    );
}
