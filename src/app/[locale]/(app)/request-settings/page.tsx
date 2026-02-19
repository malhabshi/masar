
'use client';

import { useState, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { RequestType } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, FilePenLine, Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

const formSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters.'),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
  defaultRecipientId: z.string().min(1, 'A default recipient is required.'),
});

function RequestTypeDialog({
  children,
  allUsers,
  requestType,
  onSave,
}: {
  children: React.ReactNode;
  allUsers: any[];
  requestType?: RequestType;
  onSave: (data: z.infer<typeof formSchema>, id?: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isEditMode = !!requestType;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: isEditMode
      ? {
          name: requestType.name,
          description: requestType.description,
          defaultRecipientId: requestType.defaultRecipientId,
        }
      : {
          name: '',
          description: '',
          defaultRecipientId: '',
        },
  });

  const recipientOptions = [
    { id: 'admins', name: 'Admins (Group)', role: '' },
    { id: 'departments', name: 'Departments (Group)', role: '' },
    ...allUsers,
  ];

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);
    onSave(values, requestType?.id);
    // Simulate server action delay
    await new Promise(resolve => setTimeout(resolve, 500));
    setIsLoading(false);
    setIsOpen(false);
    if (!isEditMode) {
      form.reset();
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit' : 'Add'} Request Type</DialogTitle>
          <DialogDescription>
            {isEditMode ? 'Update the details for this request type.' : 'Create a new request type for employees.'}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., New University Application" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea placeholder="A short description of what this request is for." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="defaultRecipientId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Default Recipient</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a default recipient" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {recipientOptions.map(opt => (
                        <SelectItem key={opt.id} value={opt.id}>
                          {opt.name} {opt.role && `(${opt.role})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function RequestSettingsPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users: allUsers, usersLoading } = useUsers();
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const requestTypesCollection = useMemo(() => {
    if (!firestore || !currentUser) return null;
    return collection(firestore, 'request_types');
  }, [firestore, currentUser]);

  const { data: requestTypes, isLoading: areRequestTypesLoading } = useCollection<RequestType>(requestTypesCollection);
  const isLoading = isUserLoading || areRequestTypesLoading || usersLoading;

  const handleSave = (data: z.infer<typeof formSchema>, id?: string) => {
    if (!firestore || !requestTypesCollection) return;

    if (id) {
      // Update
      const docRef = doc(firestore, 'request_types', id);
      updateDocumentNonBlocking(docRef, data);
      toast({ title: 'Request Type Updated' });
    } else {
      // Add
      addDocumentNonBlocking(requestTypesCollection, data);
      toast({ title: 'Request Type Added' });
    }
  };

  const handleDelete = (id: string) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'request_types', id);
    deleteDocumentNonBlocking(docRef);
    toast({ title: 'Request Type Deleted' });
  };

  const getRecipientName = (id: string) => {
    if (id === 'admins') return 'Admins (Group)';
    if (id === 'departments') return 'Departments (Group)';
    return allUsers.find(u => u.id === id)?.name || 'Unknown';
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }
  
  if (!currentUser) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please sign in to view this page.</p>
      </div>
    );
  }

  if (currentUser.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Request Settings</CardTitle>
          <CardDescription>
            Manage the predefined request types available to employees.
          </CardDescription>
        </div>
        <RequestTypeDialog onSave={handleSave} allUsers={allUsers}>
          <Button>
            <PlusCircle className="mr-2 h-4 w-4" />
            Add Request Type
          </Button>
        </RequestTypeDialog>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Default Recipient</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requestTypes && requestTypes.length > 0 ? (
                requestTypes.map(rt => (
                  <TableRow key={rt.id}>
                    <TableCell className="font-medium">{rt.name}</TableCell>
                    <TableCell className="text-muted-foreground">{rt.description}</TableCell>
                    <TableCell>{getRecipientName(rt.defaultRecipientId)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
                        <RequestTypeDialog requestType={rt} onSave={handleSave} allUsers={allUsers}>
                            <Button variant="ghost" size="icon">
                                <FilePenLine className="h-4 w-4" />
                            </Button>
                        </RequestTypeDialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action cannot be undone. This will permanently delete this request type.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(rt.id)}>Continue</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center">
                    No request types created yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
