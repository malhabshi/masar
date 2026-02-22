'use client';

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatRelativeTime, sortByDate, toDate } from '@/lib/timestamp-utils';
import type { Task, User } from '@/lib/types';
import { CheckCircle, Clock, AlertCircle, MessageSquare } from 'lucide-react';

interface TaskHistoryProps {
  tasks: Task[];
  users: User[];
  studentId?: string;
}

export function TaskHistory({ tasks, users, studentId }: TaskHistoryProps) {
  const relevantTasks = useMemo(() => {
    if (!tasks) return [];
    
    // Filter tasks related to this student if studentId is provided
    let filtered = tasks;
    if (studentId) {
      filtered = tasks.filter(task => 
        task.content.includes(studentId) || 
        (task.replies && task.replies.some(r => r.content.includes(studentId)))
      );
    }
    
    return filtered.sort((a, b) => sortByDate(a,b));
  }, [tasks, studentId]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'in-progress':
        return <Clock className="h-4 w-4 text-yellow-500" />;
      case 'archived':
        return <AlertCircle className="h-4 w-4 text-gray-500" />;
      default:
        return <MessageSquare className="h-4 w-4 text-blue-500" />;
    }
  };

  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    return user?.name || 'Unknown User';
  };

  if (relevantTasks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Task History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No task history found for this student.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {relevantTasks.map((task) => (
            <div key={task.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
              {getStatusIcon(task.status)}
              <div className="flex-1">
                <p className="text-sm">{task.content}</p>
                <p className="text-xs text-muted-foreground">
                  From: {getUserName(task.authorId)} • {formatRelativeTime(task.createdAt)}
                </p>
                {task.replies && task.replies.length > 0 && (
                  <div className="mt-2 ml-4 space-y-1">
                    {task.replies.map((reply) => (
                      <div key={reply.id} className="text-xs border-l-2 pl-2">
                        <p>{reply.content}</p>
                        <p className="text-muted-foreground">
                          {getUserName(reply.authorId)} • {formatRelativeTime(reply.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
