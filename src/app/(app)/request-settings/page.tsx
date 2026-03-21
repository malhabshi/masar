'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { RequestType, User } from '@/lib/types';
import { createRequestType, updateRequestType, deleteRequestType } from '@/lib/actions';

// UI components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlusCircle, Trash2, Pencil, CheckCircle, XCircle } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { RequestTypeDialog } from '@/components/request-settings/request-type-dialog';

export default function RequestSettingsPage() {
    const { user: currentUser, isUserLoading } = useUser();
    const { data: users, isLoading: usersLoading } = useCollection<User>('users');
    const { data: requestTypes, isLoading: requestTypesAreLoading } = useCollection<RequestType>('request_types');
    const { toast } = useToast();

    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingRequestType, setEditingRequestType] = useState<RequestType | undefined>(undefined);

    const isLoading = isUserLoading || requestTypesAreLoading || usersLoading;
    const isAdmin = currentUser?.role === 'admin';

    const handleAddOrUpdate = async (values: any) => {
        if (editingRequestType) {
            const result = await updateRequestType(editingRequestType.id, values);
            if (result.success) toast({ title: 'Updated', description: 'Request type updated successfully.' });
            else toast({ variant: 'destructive', title: 'Error', description: result.message });
        } else {
            const result = await createRequestType({
                ...values,
                createdBy: currentUser?.email || 'unknown',
            });
            if (result.success) toast({ title: 'Success', description: 'New request type created.' });
            else toast({ variant: 'destructive', title: 'Error', description: result.message });
        }
        setEditingRequestType(undefined);
        setIsDialogOpen(false);
    };

    const handleDelete = async (id: string) => {
        const result = await deleteRequestType(id);
        if (result.success) toast({ title: 'Deleted', description: 'Request type removed.' });
        else toast({ variant: 'destructive', title: 'Error', description: result.message });
    };

    if (isLoading) {
        return <div className="flex h-full w-full items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    if (!currentUser || currentUser.role !== 'admin') {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Access Denied</CardTitle>
                    <CardDescription>You do not have permission to access request settings.</CardDescription>
                </CardHeader>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Request Settings</h1>
                    <p className="text-muted-foreground mt-1">Configure formal task types and automated routing rules.</p>
                </div>
                {isAdmin && (
                    <Button onClick={() => { setEditingRequestType(undefined); setIsDialogOpen(true); }}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add Request Type
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Request Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead>Recipients</TableHead>
                                <TableHead>Required Fields</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Actions</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {requestTypes && requestTypes.length > 0 ? (
                                requestTypes.map((rt) => (
                                    <TableRow key={rt.id}>
                                        <TableCell className="font-semibold">{rt.name}</TableCell>
                                        <TableCell className="max-w-[200px] truncate" title={rt.description}>{rt.description}</TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {(rt.recipients || []).map((r, i) => (
                                                    <Badge key={i} variant="secondary" className="text-[10px]">
                                                        {r.name || r.id}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-xs text-muted-foreground">
                                                {rt.requiredFields?.length ? rt.requiredFields.join(', ') : 'None'}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {rt.isActive ? (
                                                <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                                                    <CheckCircle className="h-3 w-3 mr-1" /> Active
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-muted-foreground">
                                                    <XCircle className="h-3 w-3 mr-1" /> Inactive
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                {isAdmin && (
                                                    <>
                                                        <Button variant="ghost" size="icon" onClick={() => { setEditingRequestType(rt); setIsDialogOpen(true); }}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" className="text-destructive">
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Delete Request Type?</AlertDialogTitle>
                                                                    <AlertDialogDescription>This action cannot be undone. Employees will no longer be able to select this type.</AlertDialogDescription>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDelete(rt.id)}>Delete</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            ) : (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No request types configured.</TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {isAdmin && (
                <RequestTypeDialog
                    isOpen={isDialogOpen}
                    setIsOpen={setIsDialogOpen}
                    requestType={editingRequestType}
                    onSubmit={handleAddOrUpdate}
                    users={users || []}
                />
            )}
        </div>
    );
}
