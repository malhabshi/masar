'use client';
import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useFirebase, useCollection, addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import type { RequestType, User } from '@/lib/types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, PlusCircle, Trash2, Pencil } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useUsers } from '@/contexts/users-provider';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const requestTypeSchema = z.object({
  name: z.string().min(3, 'Name must be at least 3 characters.'),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
  defaultRecipientId: z.string().min(1, 'Please select a default recipient.'),
});

function RequestTypeDialog({
  isOpen,
  setIsOpen,
  requestType,
  admins,
  onSubmit,
}: {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  requestType?: RequestType;
  admins: User[];
  onSubmit: (values: z.infer<typeof requestTypeSchema>) => void;
}) {
  const form = useForm<z.infer<typeof requestTypeSchema>>({
    resolver: zodResolver(requestTypeSchema),
    defaultValues: requestType || {
      name: '',
      description: '',
      defaultRecipientId: '',
    },
  });

  React.useEffect(() => {
    if (isOpen) {
      form.reset(requestType || { name: '', description: '', defaultRecipientId: '' });
    }
  }, [isOpen, form, requestType]);

  const handleSubmit = (values: z.infer<typeof requestTypeSchema>) => {
    onSubmit(values);
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{requestType ? 'Edit' : 'Add'} Request Type</DialogTitle>
          <DialogDescription>
            Manage the types of requests employees can make.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Request Name</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Request Student Transfer" {...field} />
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
                    <Textarea placeholder="Describe what this request is for." {...field} />
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
                        <SelectValue placeholder="Select who receives this request" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {admins.map(admin => (
                        <SelectItem key={admin.id} value={admin.id}>{admin.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
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
  const { firestore } = useFirebase();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRequestType, setEditingRequestType] = useState<RequestType | undefined>(undefined);

  const requestTypesCollection = useMemo(() => {
    if (!firestore) return null;
    return collection(firestore, 'request_types');
  }, [firestore]);

  const { data: requestTypes, isLoading: requestTypesAreLoading } = useCollection<RequestType>(requestTypesCollection);

  const admins = useMemo(() => users.filter(u => u.role === 'admin'), [users]);
  
  const isLoading = isUserLoading || usersLoading || requestTypesAreLoading;

  const handleAddOrUpdateRequest = (values: z.infer<typeof requestTypeSchema>) => {
    if (!firestore || !requestTypesCollection) return;
    
    if (editingRequestType) {
      // Update existing
      const docRef = doc(firestore, 'request_types', editingRequestType.id);
      updateDocumentNonBlocking(docRef, values);
      toast({ title: 'Success', description: 'Request type updated.' });
    } else {
      // Add new
      addDocumentNonBlocking(requestTypesCollection, values);
      toast({ title: 'Success', description: 'New request type added.' });
    }
    setEditingRequestType(undefined);
  };

  const handleDeleteRequest = (requestTypeId: string) => {
    if (!firestore) return;
    const docRef = doc(firestore, 'request_types', requestTypeId);
    deleteDocumentNonBlocking(docRef);
    toast({ title: 'Success', description: 'Request type deleted.' });
  };
  
  if (isLoading) {
      return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  
  if (currentUser?.role !== 'admin') {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>Access Denied</CardTitle>
                  <CardDescription>You do not have the required permissions to manage request settings.</CardDescription>
              </CardHeader>
          </Card>
      );
  }

  const getRecipientName = (id: string) => users.find(u => u.id === id)?.name || id;

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
            <Button onClick={() => { setEditingRequestType(undefined); setIsDialogOpen(true); }}>
                <PlusCircle />
                Add Request Type
            </Button>
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
                            requestTypes.map((req) => (
                                <TableRow key={req.id}>
                                    <TableCell className="font-medium">{req.name}</TableCell>
                                    <TableCell className="text-muted-foreground">{req.description}</TableCell>
                                    <TableCell>{getRecipientName(req.defaultRecipientId)}</TableCell>
                                    <TableCell className="text-right">
                                      <Button variant="ghost" size="icon" onClick={() => { setEditingRequestType(req); setIsDialogOpen(true); }}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                              <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                            <AlertDialogHeader>
                                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                <AlertDialogDescription>This will permanently delete the "{req.name}" request type.</AlertDialogDescription>
                                            </AlertDialogHeader>
                                            <AlertDialogFooter>
                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                <AlertDialogAction onClick={() => handleDeleteRequest(req.id)}>Delete</AlertDialogAction>
                                            </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center">No request types configured.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>
      <RequestTypeDialog 
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        requestType={editingRequestType}
        admins={admins}
        onSubmit={handleAddOrUpdateRequest}
      />
    </>
  );
}
