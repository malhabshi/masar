
'use client';

import type { Task, User, TaskStatus } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatDistanceToNow } from 'date-fns';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bell, Trash2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
import { Button } from '../ui/button';
import { useToast } from '@/hooks/use-toast';
import { deleteTask as deleteTaskAction } from '@/lib/actions';
import { useFirebase, deleteDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface TaskListProps {
  tasks: Task[];
  users: User[];
  currentUser: User;
  isLoading: boolean;
}

const statusVariant: { [key in TaskStatus]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
    'new': 'default',
    'in-progress': 'secondary',
    'completed': 'outline',
    'archived': 'outline',
};

export function TaskList({ tasks, users, currentUser, isLoading }: TaskListProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const getAuthor = (authorId: string) => {
    return users.find(u => u.id === authorId);
  };
  
  const handleDelete = async (taskId: string) => {
    if (!firestore) return;
    const result = await deleteTaskAction(taskId);
    if(result.success) {
      const taskDocRef = doc(firestore, 'tasks', taskId);
      deleteDocumentNonBlocking(taskDocRef);
      toast({ title: "Update Deleted" });
    } else {
      toast({ variant: 'destructive', title: "Deletion failed" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>Recent updates, tasks, and notifications.</CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-72">
          {isLoading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
            <div className="space-y-4 pr-4">
              {tasks.length > 0 ? (
                tasks.map(task => {
                  const author = getAuthor(task.authorId);
                  return (
                    <div key={task.id} className="flex items-start gap-3 group">
                      <Avatar className="h-9 w-9 border">
                        {author ? (
                          <>
                            <AvatarImage src={author.avatarUrl} alt={author.name} />
                            <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                          </>
                        ) : (
                          <AvatarFallback><Bell className="h-4 w-4" /></AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                              <span className="font-semibold">{author?.name || 'System'}</span>
                              <Badge variant={statusVariant[task.status] ?? 'secondary'} className="capitalize">{task.status}</Badge>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{task.content}</p>
                      </div>
                      {currentUser?.role === 'admin' && (
                         <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete this update.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(task.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-sm text-muted-foreground py-10">
                  <Bell className="mx-auto h-8 w-8 mb-2" />
                  No new tasks or notifications.
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
