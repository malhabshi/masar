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
import { Loader2 } from 'lucide-react';
import { updateDocumentNonBlocking, useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { EditUserDialog } from './edit-user-dialog';
import { Skeleton } from '../ui/skeleton';

interface UserListProps {
  currentUser: AppUser;
}

const userRoles: UserRole[] = ['admin', 'employee', 'department'];

export function UserList({ currentUser }: UserListProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
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
        const userDocRef = doc(firestore, 'users', userToUpdate.id);
        await updateDocumentNonBlocking(userDocRef, { role: newRole });

        toast({
            title: 'Role Updated',
            description: `${userToUpdate.name}'s role has been updated to ${newRole}.`,
        });

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
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
