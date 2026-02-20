
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useFirebase } from '@/firebase';
import { EditUserDialog } from './edit-user-dialog';

interface UserListProps {
  users: User[];
  currentUser: User;
  onUpdateUserRole: (userId: string, newRole: UserRole, oldRole?: UserRole) => void;
}

const userRoles: UserRole[] = ['admin', 'employee', 'department'];

export function UserList({ users, currentUser, onUpdateUserRole }: UserListProps) {
  const { toast } = useToast();
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const { firestore } = useFirebase();

  const handleRoleChange = async (userToUpdate: User, newRole: UserRole) => {
    if (userToUpdate.id === currentUser.id) {
        toast({
            variant: 'destructive',
            title: "Action not allowed",
            description: "You cannot change your own role.",
        });
        return;
    }
    if (!firestore) {
        toast({ variant: 'destructive', title: 'Database not available' });
        return;
    }
    
    setIsUpdating(userToUpdate.id);
    
    try {
        await onUpdateUserRole(userToUpdate.id, newRole, userToUpdate.role);

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
