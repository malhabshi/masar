'use client';
import type { Student, User, Task, TaskStatus, TaskReply } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ListChecks, Send, Loader2 } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useMemo, useState, useEffect } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { addReplyToTask } from '@/lib/actions';
import { useFirebase, useCollection, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase';
import { collection, doc, query, where } from 'firebase/firestore';


interface TaskHistoryProps {
  student: Student;
  users: User[];
  currentUser: User;
}

const taskStatusVariant: { [key in TaskStatus]: 'default' | 'secondary' | 'destructive' | 'outline' } = {
    'new': 'default',
    'in-progress': 'secondary',
    'completed': 'outline',
    'archived': 'outline',
};

const getTaskTitle = (content: string) => {
    return content.split('\n')[0];
}

const getLastUpdateDate = (task: { createdAt: string; replies?: TaskReply[] }) => {
    if (task.replies && task.replies.length > 0) {
        const sortedReplies = [...task.replies].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return new Date(sortedReplies[0].createdAt);
    }
    return new Date(task.createdAt);
}

export function TaskHistory({ student, users, currentUser }: TaskHistoryProps) {
  const { firestore } = useFirebase();
  const [isClient, setIsClient] = useState(false);
  const { toast } = useToast();
  const [replyContent, setReplyContent] = useState<Record<string, string>>({});
  const [isReplying, setIsReplying] = useState<string | null>(null);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const allTasksQuery = useMemoFirebase(() => !firestore ? null : collection(firestore, 'tasks'), [firestore]);
  const { data: allTasksData, isLoading: allTasksLoading } = useCollection<Task>(allTasksQuery);

  const studentTasks = useMemo(() => {
    if (allTasksLoading || !allTasksData) return [];
    return allTasksData
      .filter(task => task.content.includes(student.name) || task.content.includes(student.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [student.name, student.id, allTasksData, allTasksLoading]);
  
  const getAuthor = (authorId: string): User | undefined => {
    return users.find(u => u.id === authorId);
  }

  const handleReply = async (taskId: string) => {
    if (!currentUser || !firestore) return;
    const content = replyContent[taskId];
    if (!content || !content.trim()) return;

    setIsReplying(taskId);

    const task = allTasksData?.find(t => t.id === taskId);
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
  };


  return (
    <Card>
      <CardHeader>
        <CardTitle>Task History</CardTitle>
        <CardDescription>A log of all tasks related to this student. Click a task to see details and add replies.</CardDescription>
      </CardHeader>
      <CardContent>
        {allTasksLoading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : studentTasks.length > 0 ? (
          <Accordion type="single" collapsible className="w-full space-y-2">
            {studentTasks.map((task) => {
              const lastUpdate = getLastUpdateDate(task);
              const author = getAuthor(task.authorId);
              const recipientName = task.recipientId === 'all' 
                    ? 'All Employees' 
                    : (getAuthor(task.recipientId)?.name || 'Unknown');
              
              const isReplyingToThisTask = isReplying === task.id;

              return (
                <AccordionItem value={task.id} key={task.id} className="border rounded-md px-4">
                  <AccordionTrigger className="hover:no-underline py-3">
                    <div className="flex-1 text-left">
                      <p className="font-semibold truncate">{getTaskTitle(task.content)}</p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground mt-1">
                          <Badge variant={taskStatusVariant[task.status] ?? 'secondary'} className="capitalize">{task.status}</Badge>
                          <span>Created: {isClient ? format(new Date(task.createdAt), 'PP') : <Skeleton className="h-4 w-20 inline-block" />}</span>
                          <span>Last Update: {isClient ? formatDistanceToNow(lastUpdate, { addSuffix: true }) : <Skeleton className="h-4 w-24 inline-block" />}</span>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-2 pb-4">
                    <div className="relative pl-4 pt-4">
                      <div className="absolute left-9 top-0 h-full w-0.5 bg-border -translate-x-1/2"></div>
                      <div className="space-y-6">
                        <div className="flex gap-4 relative">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card border z-10 shrink-0">
                                <ListChecks className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div className="flex-1 pt-2">
                                <div className="space-y-1 text-sm">
                                    <p>Task from <span className="font-semibold">{author?.name || 'System'}</span> to <span className="font-semibold">{recipientName}</span>.</p>
                                    <blockquote className="border-l-2 pl-2 italic text-muted-foreground whitespace-pre-wrap">
                                        {task.content}
                                    </blockquote>
                                </div>
                            </div>
                        </div>
                        {task.replies && task.replies.map((reply) => {
                          const replyAuthor = getAuthor(reply.authorId);
                          return (
                              <div key={reply.id} className="flex gap-4 relative">
                                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-card border z-10 shrink-0">
                                  <Avatar className="h-8 w-8">
                                      {replyAuthor ? (
                                          <>
                                          <AvatarImage src={replyAuthor.avatarUrl} alt={replyAuthor.name} />
                                          <AvatarFallback>{replyAuthor.name.charAt(0)}</AvatarFallback>
                                          </>
                                      ) : <AvatarFallback>U</AvatarFallback>}
                                  </Avatar>
                                </div>
                                <div className="flex-1 pt-2 text-sm">
                                    <div className="flex items-start justify-between">
                                        <div>
                                          <span className="font-semibold">{replyAuthor?.name}</span>
                                          <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{reply.content}</p>
                                        </div>
                                        <span className="text-xs text-muted-foreground whitespace-nowrap pl-4">
                                            {isClient ? formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true }) : <Skeleton className="h-4 w-20" />}
                                        </span>
                                    </div>
                                </div>
                              </div>
                          );
                        })}
                      </div>
                    </div>
                    {!['completed', 'archived'].includes(task.status) && (
                        <div className="pl-14 pt-6 mt-4 border-t">
                            <div className="space-y-2">
                                <Textarea
                                    placeholder="Add a reply..."
                                    value={replyContent[task.id] || ''}
                                    onChange={(e) => setReplyContent(prev => ({...prev, [task.id]: e.target.value}))}
                                    className="min-h-[60px]"
                                />
                                <div className="flex justify-end">
                                    <Button size="sm" onClick={() => handleReply(task.id)} disabled={isReplyingToThisTask}>
                                        {isReplyingToThisTask ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                                        Reply
                                    </Button>
                                </div>
                            </div>
                        </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        ) : (
            <div className="text-sm text-center text-muted-foreground py-10">
                <ListChecks className="mx-auto h-8 w-8 mb-2" />
                No tasks related to this student.
            </div>
        )}
      </CardContent>
    </Card>
  );
}
