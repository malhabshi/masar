
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import type { Task, TaskStatus, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { addReplyToTask, updateTaskStatus } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection } from '@/firebase/client';
import { sortByDate } from '@/lib/timestamp-utils';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { TaskItem } from './task-item';

interface TaskManagerProps {
    currentUser: AppUser;
}

export function TaskManager({ currentUser }: TaskManagerProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isReplying, setIsReplying] = useState<string | null>(null);
  const { toast } = useToast();
  
  const [newItems, setNewItems] = useState(new Set<string>());

  const { data: tasksData, isLoading: areTasksLoading } = useCollection<Task>(currentUser ? 'tasks' : '');
  const tasks = useMemo(() => tasksData || [], [tasksData]);

  useEffect(() => {
    if (!tasks || tasks.length === 0 || !currentUser) return;
    const storageKey = `lastViewedTasksManager_${currentUser.id}`;
    const lastViewed = localStorage.getItem(storageKey);

    const newlyAdded = new Set<string>();
    tasks.forEach(task => {
        if (!lastViewed || new Date(task.createdAt) > new Date(lastViewed)) {
            newlyAdded.add(task.id);
        }
    });

    if (newlyAdded.size > 0) {
      setNewItems(newlyAdded);
    }
    
    return () => {
      localStorage.setItem(storageKey, new Date().toISOString());
    };
  }, [tasks, currentUser.id]);

  const allUserIdsInTasks = useMemo(() => {
    const userIds = new Set<string>();
    if (tasks) {
        tasks.forEach(task => {
            userIds.add(task.authorId);
            if (task.recipientId !== 'all' && task.recipientId !== 'admins' && task.recipientId !== 'departments') {
                userIds.add(task.recipientId);
            }
            task.replies?.forEach(reply => userIds.add(reply.authorId));
        });
    }
    return Array.from(userIds);
  }, [tasks]);

  const { userMap, isLoading: areUsersLoading } = useUserCacheById(allUserIdsInTasks);
  
  const isLoading = areTasksLoading || areUsersLoading;

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
      setIsUpdatingStatus(taskId);
      const result = await updateTaskStatus(taskId, status, currentUser.id);
      if (result.success) {
          toast({
              title: "Task Status Updated",
              description: "The task status has been changed."
          });
      } else {
          toast({
              variant: 'destructive',
              title: "Error",
              description: result.message
          });
      }
      setIsUpdatingStatus(null);
  }

  const handleReply = async (taskId: string, content: string) => {
    if (!currentUser) return;
    setIsReplying(taskId);
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      toast({ variant: 'destructive', title: 'Error', description: 'Task not found.' });
      setIsReplying(null);
      return;
    }
    const result = await addReplyToTask(taskId, currentUser.id, content, task.authorId);
    if (result.success) {
        toast({ title: "Reply Sent" });
    } else {
        toast({ variant: 'destructive', title: "Error", description: result.message });
    }
    setIsReplying(null);
  }

  const filteredTasks = useMemo(() => {
    if (currentUser.role === 'admin' || currentUser.role === 'department') {
      return tasks;
    }
    return [];
  }, [tasks, currentUser]);

  const activeTasks = useMemo(() => filteredTasks.filter(t => t.status === 'new' || t.status === 'in-progress').sort((a,b) => sortByDate(a,b)), [filteredTasks]);
  const archivedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'completed' || t.status === 'archived').sort((a,b) => sortByDate(a,b)), [filteredTasks]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Management</CardTitle>
        <CardDescription>View and manage all tasks sent to employees.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
            <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
            <Tabs defaultValue="active">
                <TabsList>
                    <TabsTrigger value="active">Active Tasks ({activeTasks.length})</TabsTrigger>
                    <TabsTrigger value="archived">Archived ({archivedTasks.length})</TabsTrigger>
                </TabsList>
                <TabsContent value="active" className="mt-4">
                    <div className="space-y-4">
                        {activeTasks.length > 0 ? (
                            activeTasks.map(task => <TaskItem key={task.id} task={task} onStatusChange={handleStatusChange} isUpdatingStatus={isUpdatingStatus === task.id} onReply={handleReply} isReplying={isReplying === task.id} userMap={userMap} isNew={newItems.has(task.id)} currentUser={currentUser} />)
                        ) : (
                            <p className="p-8 text-center text-muted-foreground">No active tasks.</p>
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="archived" className="mt-4">
                     <div className="space-y-4">
                        {archivedTasks.length > 0 ? (
                            archivedTasks.map(task => <TaskItem key={task.id} task={task} onStatusChange={handleStatusChange} isUpdatingStatus={isUpdatingStatus === task.id} onReply={handleReply} isReplying={isReplying === task.id} userMap={userMap} isNew={newItems.has(task.id)} currentUser={currentUser} />)
                        ) : (
                            <p className="p-8 text-center text-muted-foreground">No archived tasks.</p>
                        )}
                    </div>
                </TabsContent>
            </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
