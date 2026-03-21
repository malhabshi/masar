
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { User, UserRole } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useState, useMemo } from 'react';
import { Loader2, Trash2, ShieldCheck, RefreshCw } from 'lucide-react';
import { useCollection } from '@/firebase/client';
import { EditUserDialog } from './edit-user-dialog';
import { Skeleton } from '../ui/skeleton';
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
import { Button } from '@/components/ui/button';
import { deleteUser, changeUserRole, repairPermissions } from '@/lib/actions';

interface UserListProps {
  currentUser: AppUser;
}

const userRoles: UserRole[] = ['admin', 'employee', 'department'];

export function UserList({ currentUser }: UserListProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [isRepairing, setIsRepairing] = useState(false);
  const { data: usersData, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');
  const users = useMemo(() => usersData || [], [usersData]);


  const handleRoleChange = async (userToUpdate: User, newRole: UserRole) => {
    if (userToUpdate.id === currentUser.id) {
        toast({
            variant: 'destructive',
            title: "Action not allowed",
            description: "You cannot change your own role.",
        });
        return;
    }
    
    setIsUpdating(userToUpdate.id);
    
    try {
        const result = await changeUserRole(userToUpdate.id, newRole, currentUser.id);
        
        if (result.success) {
            toast({
                title: 'Role Updated',
                description: `${userToUpdate.name}'s role has been updated to ${newRole}.`,
            });
        } else {
            throw new Error(result.message);
        }

    } catch (error: any) {
        toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message || 'An unexpected error occurred.',
        });
    } finally {
        setIsUpdating(null);
    }
  };

  const handleDeleteUser = async (userId: string, userName: string) => {
    setIsDeleting(userId);
    const result = await deleteUser(userId, currentUser.id);

    if (result.success) {
      toast({
        title: 'User Deleted',
        description: `${userName} has been removed from the system.`,
      });
    } else {
      toast({
        variant: 'destructive',
        title: 'Delete Failed',
        description: result.message,
      });
    }
    setIsDeleting(null);
  };

  const handleRepairPermissions = async () => {
    setIsRepairing(true);
    const result = await repairPermissions(currentUser.id);
    if (result.success) {
        toast({ title: 'Permissions Repaired', description: result.message });
    } else {
        toast({ variant: 'destructive', title: 'Repair Failed', description: result.message });
    }
    setIsRepairing(false);
  };

  if (usersLoading) {
      return (
          <div className="rounded-lg border">
              <Table>
                  <TableHeader>
                      <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Contact & Civil ID</TableHead>
                          <TableHead className="text-right">Role & Actions</TableHead>
                      </TableRow>
                  </TableHeader>
                  <TableBody>
                      {[...Array(3)].map((_, i) => (
                          <TableRow key={i}>
                              <TableCell><Skeleton className="h-10 w-32" /></TableCell>
                              <TableCell><div className="space-y-1"><Skeleton className="h-4 w-40" /><Skeleton className="h-4 w-24" /></div></TableCell>
                              <TableCell className="text-right"><Skeleton className="h-10 w-32 ml-auto" /></TableCell>
                          </TableRow>
                      ))}
                  </TableBody>
              </Table>
          </div>
      );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center px-1">
        <h2 className="text-lg font-bold">User Accounts</h2>
        <Button 
            variant="outline" 
            size="sm" 
            className="text-xs gap-2 border-primary text-primary hover:bg-primary/5"
            onClick={handleRepairPermissions}
            disabled={isRepairing}
        >
            {isRepairing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
            Repair Permissions
        </Button>
      </div>
      
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Contact & Civil ID</TableHead>
              <TableHead className="text-right">Role & Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarImage src={user.avatarUrl} alt={user.name} data-ai-hint="user avatar" />
                      <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div className="font-medium">{user.name}</div>
                  </div>
                </TableCell>
                <TableCell>
                    <div className="text-sm text-muted-foreground">{user.email}</div>
                    <div className="text-sm text-muted-foreground">{user.phone}</div>
                    <div className="text-sm font-mono text-muted-foreground">{user.civilId || 'N/A'}</div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                      {isUpdating === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                          <Select
                              defaultValue={user.role}
                              onValueChange={(newRole) => handleRoleChange(user, newRole as UserRole)}
                              disabled={user.id === currentUser.id}
                          >
                              <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder="Select role" />
                              </SelectTrigger>
                              <SelectContent>
                              {userRoles.map(role => (
                                  <SelectItem key={role} value={role} className="capitalize">
                                  {role}
                                  </SelectItem>
                              ))}
                              </SelectContent>
                          </Select>
                      )}
                      <EditUserDialog user={user} />
                      
                      {user.id !== currentUser.id && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10" disabled={isDeleting === user.id}>
                              {isDeleting === user.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete User Account?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete <strong>{user.name}</strong>? This will permanently remove their authentication account and profile. This action cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDeleteUser(user.id, user.name)} className="bg-destructive hover:bg-destructive/90">
                                Delete Account
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
