'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Task, TaskReply, TaskStatus } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { addReplyToTask, updateTaskStatus } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { formatDate, formatRelativeTime, sortByDate } from '@/lib/timestamp-utils';
import { useUsers } from '@/contexts/users-provider';

const taskStatuses: TaskStatus[] = ['new', 'in-progress', 'completed', 'archived'];

function TaskItem({ 
    task, 
    onStatusChange, 
    isUpdatingStatus, 
    onReply, 
    isReplying,
}: { 
    task: Task, 
    onStatusChange: (taskId: string, status: TaskStatus) => void, 
    isUpdatingStatus: boolean,
    onReply: (taskId: string, reply: string) => void,
    isReplying: boolean,
}) {
    const [replyContent, setReplyContent] = useState('');
    const [isClient, setIsClient] = useState(false);
    const { getUserById } = useUsers();

    useEffect(() => {
        setIsClient(true);
    }, []);
    
    const getRecipientName = (recipientId: string) => {
        if (recipientId === 'all') return 'All Employees';
        return getUserById(recipientId)?.name || 'Unknown';
    }
    
    const author = getUserById(task.authorId);

    const handleReplyClick = () => {
        if (!replyContent.trim()) return;
        onReply(task.id, replyContent);
        setReplyContent('');
    };
    
    const getResponseTime = (task: Task): string | null => {
        if (!task.replies || task.replies.length === 0) return null;
        const sortedReplies = [...task.replies].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const firstReply = sortedReplies[0];
        // Note: date-fns formatDistanceStrict would be more precise
        const diffMs = new Date(firstReply.createdAt).getTime() - new Date(task.createdAt).getTime();
        const diffMins = Math.round(diffMs / 60000);
        if (diffMins < 60) return `${diffMins} minutes`;
        const diffHours = Math.round(diffMins / 60);
        return `${diffHours} hours`;
    };

    const responseTime = getResponseTime(task);

    return (
        <Card>
            <CardHeader className="flex flex-row items-start gap-4 space-y-0 pb-4">
                <Avatar className="h-9 w-9 border">
                    {author ? (
                    <>
                        <AvatarImage src={author.avatarUrl} alt={author.name} />
                        <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                    </>
                    ) : (
                    <AvatarFallback>S</AvatarFallback>
                    )}
                </Avatar>
                <div className="flex-1">
                    <div className="flex items-center justify-between">
                        <div>
                            <span className="font-semibold">{author?.name || 'System'}</span> to <span className="font-semibold">{getRecipientName(task.recipientId)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground text-right">
                           {isClient ? (
                               <span>{formatDate(task.createdAt)}</span>
                           ) : (
                               <Skeleton className="h-4 w-36" />
                           )}
                           {responseTime && <div className="text-blue-600">Responded in {responseTime}</div>}
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.content}</p>
                </div>
                <Badge variant={task.status === 'new' || task.status === 'in-progress' ? 'default' : 'secondary'} className="capitalize">{task.status}</Badge>
            </CardHeader>
            {(task.replies && task.replies.length > 0) || !['completed', 'archived'].includes(task.status) ? (
                <CardContent className="pl-16 space-y-4 pt-0">
                    {task.replies && task.replies.length > 0 && (
                        <div className="space-y-4">
                             {task.replies.map((reply) => {
                                const replyAuthor = getUserById(reply.authorId);
                                return (
                                    <div key={reply.id} className="flex items-start gap-3">
                                        <Avatar className="h-8 w-8">
                                            {replyAuthor ? (
                                                <>
                                                <AvatarImage src={replyAuthor.avatarUrl} alt={replyAuthor.name} />
                                                <AvatarFallback>{replyAuthor.name.charAt(0)}</AvatarFallback>
                                                </>
                                            ) : <AvatarFallback>U</AvatarFallback>}
                                        </Avatar>
                                        <div className="flex-1 text-sm bg-muted p-3 rounded-lg">
                                            <div className="flex items-center justify-between">
                                                <span className="font-semibold">{replyAuthor?.name}</span>
                                                <span className="text-xs text-muted-foreground">
                                                    {isClient ? formatRelativeTime(reply.createdAt) : <Skeleton className="h-4 w-20" />}
                                                </span>
                                            </div>
                                            <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{reply.content}</p>
                                        </div>
                                    </div>
                                );
                             })}
                        </div>
                    )}
                    
                    {!['completed', 'archived'].includes(task.status) && (
                        <>
                            {task.replies && task.replies.length > 0 && <Separator/>}
                            <div className="space-y-2 pt-2">
                                <Textarea 
                                    placeholder="Add a reply..."
                                    value={replyContent}
                                    onChange={(e) => setReplyContent(e.target.value)}
                                    className="min-h-[60px]"
                                />
                                <div className="flex justify-end">
                                    <Button size="sm" onClick={handleReplyClick} disabled={isReplying}>
                                        {isReplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                        Reply
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                </CardContent>
            ) : null}
            {!['completed', 'archived'].includes(task.status) && (
                <CardFooter className="flex justify-end bg-muted/50 py-3 px-6">
                     <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">Update Status:</span>
                        <Select
                            defaultValue={task.status}
                            onValueChange={(value) => onStatusChange(task.id, value as TaskStatus)}
                            disabled={isUpdatingStatus}
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Update status" />
                            </SelectTrigger>
                            <SelectContent>
                                {taskStatuses.map(option => (
                                    <SelectItem key={option} value={option}>{option.charAt(0).toUpperCase() + option.slice(1)}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </CardFooter>
            )}
        </Card>
    );
}

interface TaskManagerProps {
    currentUser: AppUser;
}

export function TaskManager({ currentUser }: TaskManagerProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [isReplying, setIsReplying] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: tasksData, isLoading: areTasksLoading } = useCollection<Task>('tasks');
  const tasks = useMemo(() => tasksData || [], [tasksData]);

  const handleStatusChange = async (taskId: string, status: TaskStatus) => {
      setIsUpdatingStatus(taskId);
      const task = tasks.find(t => t.id === taskId);
      if (!task) {
        toast({ variant: 'destructive', title: 'Error', description: 'Task not found or database not available.' });
        setIsUpdatingStatus(null);
        return;
      }
      const result = await updateTaskStatus(taskId, status, task);
      if (result.success) {
          toast({
              title: "Task Status Updated",
              description: "The task status has been changed."
          });
          const taskDocRef = doc(firestore, 'tasks', taskId);
          updateDocumentNonBlocking(taskDocRef, { status });
      } else {
          toast({
              variant: 'destructive',
              title: "Error",
              description: "Could not update the task status."
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
        const newReply: TaskReply = {
            id: `reply-${Date.now()}`,
            authorId: currentUser.id,
            content,
            createdAt: new Date().toISOString(),
        };
        const taskDocRef = doc(firestore, 'tasks', taskId);
        const updatedReplies = [...(task.replies || []), newReply];
        updateDocumentNonBlocking(taskDocRef, { replies: updatedReplies });

        setReplyContent(prev => ({ ...prev, [taskId]: '' }));
    } else {
        toast({ variant: 'destructive', title: "Error", description: "Could not send reply." });
    }
    setIsReplying(null);
  }

  const filteredTasks = useMemo(() => {
    // Both Admin and Department roles should see all tasks on this management page.
    if (currentUser.role === 'admin' || currentUser.role === 'department') {
      return tasks;
    }
    return [];
  }, [tasks, currentUser]);

  const activeTasks = useMemo(() => filteredTasks.filter(t => t.status === 'new' || t.status === 'in-progress').sort((a,b) => sortByDate(a,b)), [filteredTasks]);
  const archivedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'completed' || t.status === 'archived').sort((a,b) => sortByDate(a,b)), [filteredTasks]);
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Management</CardTitle>
        <CardDescription>View and manage all tasks sent to employees.</CardDescription>
      </CardHeader>
      <CardContent>
        {areTasksLoading ? (
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
                            activeTasks.map(task => <TaskItem key={task.id} task={task} onStatusChange={handleStatusChange} isUpdatingStatus={isUpdatingStatus === task.id} onReply={handleReply} isReplying={isReplying === task.id} />)
                        ) : (
                            <p className="p-8 text-center text-muted-foreground">No active tasks.</p>
                        )}
                    </div>
                </TabsContent>
                <TabsContent value="archived" className="mt-4">
                     <div className="space-y-4">
                        {archivedTasks.length > 0 ? (
                            archivedTasks.map(task => <TaskItem key={task.id} task={task} onStatusChange={handleStatusChange} isUpdatingStatus={isUpdatingStatus === task.id} onReply={handleReply} isReplying={isReplying === task.id} />)
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
