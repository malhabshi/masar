
'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Task, TaskStatus } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { addReplyToTask, updateTaskStatus } from '@/lib/actions';
import { TaskItem } from '../tasks/task-item';
import { sortByDate } from '@/lib/timestamp-utils';


interface TaskHistoryProps {
  tasks: Task[];
  studentId: string;
  currentUser: AppUser;
  isLoading: boolean;
}

export function TaskHistory({ tasks, studentId, currentUser, isLoading }: TaskHistoryProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isReplying, setIsReplying] = useState<string | null>(null);
  const { toast } = useToast();

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => sortByDate(a, b));
  }, [tasks]);

  const authorIds = useMemo(() => {
    const ids = new Set<string>();
    tasks.forEach(task => {
        ids.add(task.authorId);
        if (task.recipientId !== 'all' && task.recipientId !== 'admins' && task.recipientId !== 'departments') {
            ids.add(task.recipientId);
        }
        (task.replies || []).forEach(reply => ids.add(reply.authorId));
    });
    return Array.from(ids);
  }, [tasks]);

  const { userMap } = useUserCacheById(authorIds);

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
  };

  const handleReply = async (taskId: string, content: string) => {
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
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task History</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
            <div className="flex justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        ) : sortedTasks.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No task history found for this student.</p>
        ) : (
            <div className="space-y-4">
                {sortedTasks.map(task => (
                    <TaskItem 
                        key={task.id}
                        task={task}
                        onStatusChange={handleStatusChange}
                        isUpdatingStatus={isUpdatingStatus === task.id}
                        onReply={handleReply}
                        isReplying={isReplying === task.id}
                        userMap={userMap}
                        currentUser={currentUser}
                    />
                ))}
            </div>
        )}
      </CardContent>
    </Card>
  );
}
