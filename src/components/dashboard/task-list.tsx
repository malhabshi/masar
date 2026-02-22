'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { firestore, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';
import { Loader2, Send } from 'lucide-react';
import { formatRelativeTime } from '@/lib/timestamp-utils';
import type { Task, User, TaskReply } from '@/lib/types';

interface TaskListProps {
  tasks: Task[];
  users: User[];
  currentUser: User;
  isLoading: boolean;
}

export function TaskList({ tasks, users, currentUser, isLoading }: TaskListProps) {
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [isReplying, setIsReplying] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.name || 'Unknown User';
  };

  const handleReply = async (taskId: string) => {
    if (!replyContent[taskId]?.trim()) return;
    
    setIsReplying(prev => ({ ...prev, [taskId]: true }));
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
        toast({ variant: 'destructive', title: 'Error', description: 'Task not found.' });
        setIsReplying(prev => ({ ...prev, [taskId]: false }));
        return;
    }

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
    setIsReplying(prev => ({ ...prev, [taskId]: false }));
    toast({ title: 'Reply sent' });
  };

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
            <div key={task.id} className="space-y-4 border-b pb-4 last:border-0">
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
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
