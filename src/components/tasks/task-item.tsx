
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Send } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate, formatRelativeTime } from '@/lib/timestamp-utils';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import Link from 'next/link';

const taskStatuses: TaskStatus[] = ['new', 'in-progress', 'completed', 'archived'];

export function TaskItem({ 
    task, 
    onStatusChange, 
    isUpdatingStatus, 
    onReply, 
    isReplying,
    userMap,
    currentUser,
    isNew,
}: { 
    task: Task, 
    onStatusChange: (taskId: string, status: TaskStatus) => void, 
    isUpdatingStatus: boolean,
    onReply: (taskId: string, reply: string) => void,
    isReplying: boolean,
    userMap: Map<string, User>,
    currentUser: AppUser,
    isNew?: boolean,
}) {
    const [replyContent, setReplyContent] = useState('');
    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
        setIsClient(true);
    }, []);
    
    const getRecipientName = (recipientId: string) => {
        if (recipientId === 'all') return 'All Employees';
        if (recipientId === 'admins') return 'All Admins';
        if (recipientId === 'departments') return 'All Departments';
        return userMap.get(recipientId)?.name || '...';
    }
    
    const author = userMap.get(task.authorId);
    const canManageTask = currentUser.role === 'admin' || currentUser.role === 'department';

    const handleReplyClick = () => {
        if (!replyContent.trim()) return;
        onReply(task.id, replyContent);
        setReplyContent('');
    };
    
    const getResponseTime = (task: Task): string | null => {
        if (!task.replies || task.replies.length === 0) return null;
        const sortedReplies = [...task.replies].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
        const firstReply = sortedReplies[0];
        const diffMs = new Date(firstReply.createdAt).getTime() - new Date(task.createdAt).getTime();
        const diffMins = Math.round(diffMs / 60000);
        if (diffMins < 1) return '< 1 minute';
        if (diffMins < 60) return `${diffMins} minutes`;
        const diffHours = Math.round(diffMins / 60);
        return `${diffHours} hours`;
    };

    const responseTime = getResponseTime(task);

    return (
        <Card className={cn("transition-colors duration-500", isNew && "bg-blue-500/10")}>
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
                    <div className="flex items-start justify-between">
                        <div>
                            <span className="font-semibold">{author?.name || 'System'}</span> to <span className="font-semibold">{getRecipientName(task.recipientId)}</span>
                            {task.studentName && task.studentId && (
                                <p className="text-sm">
                                    Regarding: <Link href={`/student/${task.studentId}`} className="font-semibold text-primary hover:underline">{task.studentName}</Link>
                                </p>
                            )}
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
                    {task.taskType && <Badge variant="secondary" className="mt-1">{task.taskType}</Badge>}
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-2">{task.content}</p>
                </div>
                <Badge variant={task.status === 'new' || task.status === 'in-progress' ? 'default' : 'secondary'} className="capitalize">{task.status}</Badge>
            </CardHeader>
            {(task.replies && task.replies.length > 0) || (canManageTask && !['completed', 'archived'].includes(task.status)) ? (
                <CardContent className="pl-16 space-y-4 pt-0">
                    {task.replies && task.replies.length > 0 && (
                        <div className="space-y-4">
                             {task.replies.map((reply) => {
                                const replyAuthor = userMap.get(reply.authorId);
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
                    
                    {canManageTask && !['completed', 'archived'].includes(task.status) && (
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
            {canManageTask && !['completed', 'archived'].includes(task.status) && (
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
