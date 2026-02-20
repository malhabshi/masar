
'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PlusCircle, Edit, Trash2, MoreHorizontal, Loader2 } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';
import { useUsers } from '@/contexts/users-provider';
import type { RequestType } from '@/lib/types';
import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

export default function RequestSettingsPage() {
  const { user, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();
  const { toast } = useToast();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState<RequestType | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [recipient, setRecipient] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const requestTypesCollection = useMemo(() => !firestore ? null : collection(firestore, 'request_types'), [firestore]);
  const { data: requestTypes, isLoading: areRequestTypesLoading } = useCollection<RequestType>(requestTypesCollection);

  const isLoading = isUserLoading || usersLoading || areRequestTypesLoading;

  const recipientOptions = useMemo(() => {
      const managementUsers = users.filter(u => ['admin', 'department'].includes(u.role));
      return [
        { value: 'admins', label: 'Admins (Group)' },
        { value: 'departments', label: 'Departments (Group)' },
        ...managementUsers.map(u => ({ value: u.id, label: `${u.name} (${u.role})` }))
      ];
  }, [users]);
  
  const getRecipientLabel = (id: string) => {
    return recipientOptions.find(opt => opt.value === id)?.label || id;
  }

  const handleOpenDialog = (requestType: RequestType | null) => {
    setIsEditing(requestType);
    if (requestType) {
      setName(requestType.name);
      setDescription(requestType.description);
      setRecipient(requestType.defaultRecipientId);
    } else {
      setName('');
      setDescription('');
      setRecipient('');
    }
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!name || !description || !recipient || !firestore || !requestTypesCollection) {
        toast({ variant: 'destructive', title: 'All fields are required.' });
        return;
    }
    setIsSaving(true);
    
    if (isEditing) {
        // Update existing
        const docRef = doc(requestTypesCollection, isEditing.id);
        updateDocumentNonBlocking(docRef, { name, description, defaultRecipientId: recipient });
        toast({ title: 'Request Type Updated' });
    } else {
        // Add new
        addDocumentNonBlocking(requestTypesCollection, { name, description, defaultRecipientId: recipient });
        toast({ title: 'Request Type Added' });
    }

    setIsSaving(false);
    setDialogOpen(false);
  };
  
  const handleDelete = (id: string) => {
    if (!firestore || !requestTypesCollection) return;
    const docRef = doc(requestTypesCollection, id);
    deleteDocumentNonBlocking(docRef);
    toast({ title: 'Request Type Deleted' });
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  if (user?.role !== 'admin') {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>Permission Denied</CardTitle>
                  <CardDescription>Only administrators can manage request types.</CardDescription>
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
            <CardDescription>Manage the types of requests employees can make.</CardDescription>
          </div>
          <Button onClick={() => handleOpenDialog(null)}>
            <PlusCircle className="mr-2 h-4 w-4" />
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
                  requestTypes.map((rt) => (
                    <TableRow key={rt.id}>
                      <TableCell className="font-medium">{rt.name}</TableCell>
                      <TableCell className="text-muted-foreground">{rt.description}</TableCell>
                      <TableCell>{getRecipientLabel(rt.defaultRecipientId)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(rt)}>
                            <Edit className="h-4 w-4" />
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
                                <AlertDialogDescription>
                                    This action will permanently delete the "{rt.name}" request type.
                                </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(rt.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="h-24 text-center">
                      No request types configured yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit' : 'Add'} Request Type</DialogTitle>
            <DialogDescription>
              {isEditing ? 'Update the details for this request type.' : 'Create a new type of request for employees.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
                <label htmlFor="req-name">Name</label>
                <Input id="req-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Request Passport Copy" />
            </div>
            <div className="space-y-2">
                <label htmlFor="req-desc">Description</label>
                <Textarea id="req-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short explanation of what this request is for." />
            </div>
            <div className="space-y-2">
                <label htmlFor="req-recipient">Default Recipient</label>
                <Select value={recipient} onValueChange={setRecipient}>
                    <SelectTrigger id="req-recipient">
                        <SelectValue placeholder="Select a default recipient" />
                    </SelectTrigger>
                    <SelectContent>
                        {recipientOptions.map(opt => (
                            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button onClick={handleSave} disabled={isSaving}>
                {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
