
'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Send, Phone, User, Eye, Save, Bell } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate, formatRelativeTime } from '@/lib/timestamp-utils';
import { cn } from '@/lib/utils';
import type { Task, TaskStatus, User as UserType } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import Link from 'next/link';
import { toggleTaskPriority } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

const statusVariants: Record<TaskStatus, string> = {
  new: 'bg-blue-500 hover:bg-blue-600',
  'in-progress': 'bg-orange-500 hover:bg-orange-600',
  completed: 'bg-green-500 hover:bg-green-600',
  denied: 'bg-red-500 hover:bg-red-600',
};

export function TaskItem({ 
    task, 
    onStatusChange, 
    isUpdatingStatus, 
    userMap,
    currentUser,
    isNew,
    onViewDetails,
}: { 
    task: Task, 
    onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>, 
    isUpdatingStatus: boolean,
    userMap: Map<string, UserType>,
    currentUser: AppUser,
    isNew?: boolean,
    onViewDetails?: () => void,
}) {
    const [isClient, setIsClient] = useState(false);
    const [localStatus, setLocalStatus] = useState<TaskStatus>(task.status);
    const [isPrioritizing, setIsPrioritizing] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        setIsClient(true);
    }, []);

    useEffect(() => {
        setLocalStatus(task.status);
    }, [task.status]);
    
    const author = userMap.get(task.authorId);
    const hasStatusChanged = localStatus !== task.status;
    const canManage = ['admin', 'department'].includes(currentUser.role);

    const handleTogglePriority = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isPrioritizing) return;
        setIsPrioritizing(true);
        const result = await toggleTaskPriority(task.id, !task.isPrioritized);
        if (result.success) {
            toast({ title: task.isPrioritized ? 'Priority Removed' : 'Task Prioritized' });
        }
        setIsPrioritizing(false);
    };
    
    return (
        <Card className={cn(
          "flex flex-col h-full border transition-all duration-300 hover:shadow-md",
          isNew && "border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.1)]",
          task.isPrioritized && "border-red-500 border-2 shadow-[0_0_15px_rgba(239,68,68,0.15)]",
          !task.isPrioritized && task.status === 'new' && "border-l-4 border-l-blue-500",
          !task.isPrioritized && task.status === 'in-progress' && "border-l-4 border-l-orange-500",
          !task.isPrioritized && task.status === 'completed' && "border-l-4 border-l-green-500",
          !task.isPrioritized && task.status === 'denied' && "border-l-4 border-l-red-500"
        )}>
            <CardHeader className="p-4 pb-2">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge className={cn("capitalize text-[10px] px-2 h-5", statusVariants[task.status])}>
                        {task.status.replace('-', ' ')}
                    </Badge>
                    {canManage && (
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className={cn("h-6 w-6", task.isPrioritized ? "text-red-600" : "text-muted-foreground")}
                            onClick={handleTogglePriority}
                            disabled={isPrioritizing}
                        >
                            {isPrioritizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bell className={cn("h-3.5 w-3.5", task.isPrioritized && "fill-current")} />}
                        </Button>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    {isClient ? formatDate(task.createdAt) : '...'}
                  </span>
                </div>
                <CardTitle className="text-base line-clamp-1">{task.taskType || 'Standard Task'}</CardTitle>
                <div className="space-y-1 mt-2">
                  <div className="flex items-center gap-2 text-sm text-primary font-bold">
                    <User className="h-3 w-3" />
                    <Link href={`/student/${task.studentId}`} className="hover:underline">
                      {task.studentName || 'Student Profile'}
                    </Link>
                  </div>
                  {task.studentPhone && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      {task.studentPhone}
                    </div>
                  )}
                </div>
            </CardHeader>
            <CardContent className="p-4 pt-2 flex-1">
                <p className="text-sm text-muted-foreground line-clamp-2 italic mb-4">
                  "{task.content}"
                </p>
                <div className="flex items-center gap-2 pt-2 border-t">
                  <Avatar className="h-6 w-6">
                    <AvatarImage src={author?.avatarUrl} />
                    <AvatarFallback>{author?.name?.charAt(0) || 'E'}</AvatarFallback>
                  </Avatar>
                  <span className="text-[11px] text-muted-foreground font-medium">
                    By: <span className="text-foreground">{task.authorName || author?.name || 'Employee'}</span>
                  </span>
                </div>
            </CardContent>
            <CardFooter className="p-4 pt-0 gap-2 flex-col items-stretch">
              <div className="flex items-center gap-2">
                {canManage && (
                  <Select 
                    value={localStatus} 
                    onValueChange={(v) => setLocalStatus(v as TaskStatus)}
                    disabled={isUpdatingStatus}
                  >
                    <SelectTrigger className="h-8 text-[10px] font-bold uppercase flex-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="new">NEW</SelectItem>
                      <SelectItem value="in-progress">IN PROGRESS</SelectItem>
                      <SelectItem value="completed">COMPLETED</SelectItem>
                      <SelectItem value="denied">DENIED</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className={cn("text-xs font-bold gap-2", !canManage && "w-full")}
                  onClick={onViewDetails}
                >
                  <Eye className="h-3 w-3" />
                  Details
                </Button>
              </div>
              
              {hasStatusChanged && (
                <Button 
                  size="sm" 
                  className="w-full text-xs font-bold gap-2 h-8 animate-in fade-in slide-in-from-top-1"
                  onClick={() => onStatusChange(task.id, localStatus)}
                  disabled={isUpdatingStatus}
                >
                  {isUpdatingStatus ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save Status
                </Button>
              )}
            </CardFooter>
        </Card>
    );
}
