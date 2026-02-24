
'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Loader2, Send } from 'lucide-react';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import type { Task, TaskReply } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { addReplyToTask } from '@/lib/actions';
import { cn } from '@/lib/utils';

interface TaskListProps {
  tasks: Task[];
  currentUser: AppUser;
  isLoading: boolean;
}

export function TaskList({ tasks, currentUser, isLoading }: TaskListProps) {
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [isReplying, setIsReplying] = useState<Record<string, boolean>>({});
  const { toast } = useToast();
  
  const [newItems, setNewItems] = useState(new Set<string>());

  useEffect(() => {
    if (!tasks || tasks.length === 0 || !currentUser) return;

    const storageKey = `lastViewedTasks_${currentUser.id}`;
    const lastViewed = localStorage.getItem(storageKey);

    const newlyAdded = new Set<string>();
    tasks.forEach(task => {
      const isForCurrentUser = task.recipientId === currentUser.id || (task.recipientId === 'all' && currentUser.role === 'employee');
      if (isForCurrentUser && (!lastViewed || new Date(task.createdAt) > new Date(lastViewed))) {
        newlyAdded.add(task.id);
      }
    });

    if (newlyAdded.size > 0) {
      setNewItems(newlyAdded);
    }
    
    return () => {
      localStorage.setItem(storageKey, new Date().toISOString());
    };
  }, [tasks, currentUser.id, currentUser.role]);


  const allUserIds = useMemo(() => {
    const ids = new Set<string>();
    (tasks || []).forEach(task => {
        ids.add(task.authorId);
        (task.replies || []).forEach(reply => ids.add(reply.authorId));
    });
    return Array.from(ids);
  }, [tasks]);

  const { userMap } = useUserCacheById(allUserIds);

  const getUserName = (userId: string) => {
    return userMap.get(userId)?.name || '...';
  };

  const handleReply = async (taskId: string) => {
    if (!replyContent[taskId]?.trim()) return;
    
    const canReply = currentUser.role === 'admin' || currentUser.role === 'department';
    if (!canReply) {
        toast({ variant: 'destructive', title: 'Error', description: 'You do not have permission to reply.' });
        return;
    }

    setIsReplying(prev => ({ ...prev, [taskId]: true }));
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        toast({ variant: 'destructive', title: 'Error', description: 'Task not found.' });
        setIsReplying(prev => ({ ...prev, [taskId]: false }));
        return;
    }
    
    const result = await addReplyToTask(taskId, currentUser.id, replyContent[taskId].trim(), task.authorId);

    if (result.success) {
      const newReply: TaskReply = {
        id: `reply-${Date.now()}`,
        authorId: currentUser.id,
        content: replyContent[taskId].trim(),
        createdAt: new Date().toISOString(),
      };
      
      const taskDocRef = doc(firestore, 'tasks', taskId);
      const updatedReplies = [...(task.replies || []), newReply];
      updateDocumentNonBlocking(taskDocRef, { replies: updatedReplies });
      
      setReplyContent(prev => ({ ...prev, [taskId]: '' }));
      toast({ title: 'Reply sent' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }

    setIsReplying(prev => ({ ...prev, [taskId]: false }));
  };
  
  const canCreateOrReply = currentUser.role === 'admin' || currentUser.role === 'department';

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task Feed</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Feed</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {tasks.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">No tasks found.</p>
        ) : (
          tasks.map((task) => (
            <div key={task.id} className={cn(
                "space-y-4 border-b pb-4 last:border-0 transition-colors duration-500 p-4 rounded-lg",
                newItems.has(task.id) && "bg-blue-500/10"
              )}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium">{task.content}</p>
                  <p className="text-sm text-muted-foreground">
                    From: {getUserName(task.authorId)} • {formatRelativeTime(task.createdAt)}
                  </p>
                </div>
              </div>
              
              {task.replies && task.replies.length > 0 && (
                <div className="ml-4 space-y-2 border-l-2 pl-4">
                  {task.replies.map((reply) => (
                    <div key={reply.id} className="text-sm">
                      <p>{reply.content}</p>
                      <p className="text-xs text-muted-foreground">
                        {getUserName(reply.authorId)} • {formatRelativeTime(reply.createdAt)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              
              {canCreateOrReply && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Write a reply..."
                    value={replyContent[task.id] || ''}
                    onChange={(e) => setReplyContent(prev => ({ ...prev, [task.id]: e.target.value }))}
                    className="flex-1"
                  />
                  <Button 
                    size="sm" 
                    onClick={() => handleReply(task.id)}
                    disabled={isReplying[task.id] || !replyContent[task.id]?.trim()}
                  >
                    {isReplying[task.id] ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
