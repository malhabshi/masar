'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Task, TaskStatus, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { addReplyToTask, updateTaskStatus, markTaskAsSeen, sendTaskNotification } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Search, User as UserIcon, Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where } from 'firebase/firestore';
import { sortByDate } from '@/lib/timestamp-utils';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { TaskItem } from './task-item';
import { TaskDetailsDialog } from './task-details-dialog';
import { Input } from '@/components/ui/input';

interface TaskManagerProps {
    currentUser: AppUser;
}

export function TaskManager({ currentUser }: TaskManagerProps) {
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<string | null>(null);
  const [selectedTask, setSelectedRequestTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskView, setTaskView] = useState<'personal' | 'department'>('personal');
  const { toast } = useToast();
  
  const [newItems, setNewItems] = useState(new Set<string>());

  const relevantTasksConstraints = useMemoFirebase(() => {
    if (!currentUser) return [];
    
    // Admins see all tasks
    if (currentUser.role === 'admin') return [];

    const groups = [currentUser.id, 'all', 'admins'];
    if (currentUser.department) {
        groups.push(`dept:${currentUser.department}`);
    }
    
    return [where('recipientIds', 'array-contains-any', groups)];
  }, [currentUser]);

  const { data: tasksData, isLoading: areTasksLoading } = useCollection<Task>(
    currentUser ? 'tasks' : '',
    ...relevantTasksConstraints
  );
  
  const tasks = useMemo(() => tasksData || [], [tasksData]);

  useEffect(() => {
    if (!tasks || tasks.length === 0 || !currentUser) return;
    const storageKey = `lastViewedTasksManager_${currentUser.id}`;
    const lastViewed = localStorage.getItem(storageKey);

    const newlyAdded = new Set<string>();
    tasks.forEach(task => {
        const isIeltsCourse = task.data?.examType === 'ielts_course' || 
                             task.taskType?.toLowerCase() === 'ielts course';

        if (task.category === 'request' && !isIeltsCourse && (!lastViewed || new Date(task.createdAt) > new Date(lastViewed))) {
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
            (task.recipientIds || []).forEach(rid => {
                if (!rid.startsWith('dept:') && !['all', 'admins'].includes(rid)) {
                    userIds.add(rid);
                }
            });
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
          toast({ variant: 'destructive', title: "Error", description: result.message });
      }
      setIsUpdatingStatus(null);
  }

  const handleReply = async (taskId: string, content: string) => {
    if (!currentUser) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      toast({ variant: 'destructive', title: 'Error', description: 'Task not found.' });
      return;
    }
    const result = await addReplyToTask(taskId, currentUser.id, content, task.authorId);
    if (result.success) {
        toast({ title: "Reply Sent" });
    } else {
        toast({ variant: 'destructive', title: "Error", description: result.message });
    }
  }

  const handleViewDetails = async (task: Task) => {
    setSelectedRequestTask(task);
    if (['admin', 'department'].includes(currentUser.role)) {
      await markTaskAsSeen(task.id, currentUser.id, currentUser.name);
    }
  };

  const handleSendNotification = async (taskId: string, message: string) => {
    const result = await sendTaskNotification(taskId, currentUser.id, currentUser.name, message);
    if (result.success) {
      toast({ title: "Notification Sent", description: "The employee has been notified." });
    } else {
      toast({ variant: 'destructive', title: "Failed", description: result.message });
    }
  };

  const categorizedTasks = useMemo(() => {
    // Tasks directed to ME specifically or my general role group
    const personal = tasks.filter(t => 
      t.recipientIds?.includes(currentUser.id) || 
      (t.recipientIds?.includes('all') && currentUser.role === 'employee') ||
      (t.recipientIds?.includes('admins') && currentUser.role === 'admin')
    );

    // Tasks directed to DEPARTMENTS
    const department = tasks.filter(t => {
      if (currentUser.role === 'admin') {
        // Admins see all department-routed tasks in the "Dept" tab
        return t.recipientIds?.some(rid => rid.startsWith('dept:'));
      }
      // Department users see tasks routed to their specific department
      return currentUser.department && t.recipientIds?.includes(`dept:${currentUser.department}`);
    });

    return { personal, department };
  }, [tasks, currentUser.id, currentUser.role, currentUser.department]);

  const filteredTasks = useMemo(() => {
    const baseTasks = taskView === 'personal' ? categorizedTasks.personal : categorizedTasks.department;
    
    return baseTasks.filter(t => {
      if (t.category !== 'request') return false;

      const isIeltsCourse = t.data?.examType === 'ielts_course' || 
                           t.taskType?.toLowerCase() === 'ielts course';
      
      if (isIeltsCourse) return false;

      const query = searchQuery.toLowerCase();
      return (
        t.studentName?.toLowerCase().includes(query) ||
        t.taskType?.toLowerCase().includes(query) ||
        t.content?.toLowerCase().includes(query) ||
        t.authorName?.toLowerCase().includes(query) ||
        t.studentPhone?.includes(query)
      );
    });
  }, [categorizedTasks, taskView, searchQuery]);

  const newTasks = useMemo(() => filteredTasks.filter(t => t.status === 'new').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const progressTasks = useMemo(() => filteredTasks.filter(t => t.status === 'in-progress').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const completedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'completed').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const deniedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'denied').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Task Management</CardTitle>
            <CardDescription>Structured FIFO workflow for student requests. Changes must be saved to update status.</CardDescription>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-4">
            <div className="bg-muted p-1 rounded-lg flex items-center gap-1">
                <Button 
                    variant={taskView === 'personal' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    className="h-8 gap-2 text-xs font-bold"
                    onClick={() => setTaskView('personal')}
                >
                    <UserIcon className="h-3.5 w-3.5" />
                    My Tasks ({categorizedTasks.personal.length})
                </Button>
                <Button 
                    variant={taskView === 'department' ? 'secondary' : 'ghost'} 
                    size="sm" 
                    className="h-8 gap-2 text-xs font-bold"
                    onClick={() => setTaskView('department')}
                >
                    <Building2 className="h-3.5 w-3.5" />
                    Dept Tasks ({categorizedTasks.department.length})
                </Button>
            </div>
            <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                placeholder="Search requests..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
              <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
          ) : (
              <Tabs defaultValue="new">
                  <TabsList className="grid grid-cols-4 w-full md:w-auto">
                      <TabsTrigger value="new">New ({newTasks.length})</TabsTrigger>
                      <TabsTrigger value="progress">In Progress ({progressTasks.length})</TabsTrigger>
                      <TabsTrigger value="completed">Completed ({completedTasks.length})</TabsTrigger>
                      <TabsTrigger value="denied">Denied ({deniedTasks.length})</TabsTrigger>
                  </TabsList>
                  
                  {[
                    { val: 'new', list: newTasks, empty: 'No new requests.' },
                    { val: 'progress', list: progressTasks, empty: 'No tasks in progress.' },
                    { val: 'completed', list: completedTasks, empty: 'No completed tasks yet.' },
                    { val: 'denied', list: deniedTasks, empty: 'No denied requests.' }
                  ].map(tab => (
                    <TabsContent key={tab.val} value={tab.val} className="mt-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {tab.list.length > 0 ? (
                                tab.list.map(task => (
                                  <TaskItem 
                                    key={task.id} 
                                    task={task} 
                                    onStatusChange={handleStatusChange} 
                                    isUpdatingStatus={isUpdatingStatus === task.id} 
                                    userMap={userMap} 
                                    isNew={newItems.has(task.id)} 
                                    currentUser={currentUser}
                                    onViewDetails={() => handleViewDetails(task)}
                                  />
                                ))
                            ) : (
                                <p className="col-span-full p-12 text-center text-muted-foreground border border-dashed rounded-lg">
                                  {tab.empty}
                                </p>
                            )}
                        </div>
                    </TabsContent>
                  ))}
              </Tabs>
          )}
        </CardContent>
      </Card>

      {selectedTask && (
        <TaskDetailsDialog
          isOpen={!!selectedTask}
          onOpenChange={(open) => !open && setSelectedRequestTask(null)}
          task={selectedTask}
          currentUser={currentUser}
          userMap={userMap}
          onStatusChange={handleStatusChange}
          onReply={handleReply}
          onSendNotification={handleSendNotification}
        />
      )}
    </div>
  );
}
