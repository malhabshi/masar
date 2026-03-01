
'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Task, TaskStatus, User } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { addReplyToTask, updateTaskStatus, markTaskAsSeen, sendTaskNotification, markMultipleTasksAsSeen } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, Search, User as UserIcon, Building2 } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection, useMemoFirebase } from '@/firebase';
import { where, query, collection, orderBy } from 'firebase/firestore';
import { firestore } from '@/firebase';
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
  
  const [taskView, setTaskView] = useState<'personal' | 'department'>(
    currentUser?.role === 'department' ? 'department' : 'personal'
  );
  
  const { toast } = useToast();
  const [newItems, setNewItems] = useState(new Set<string>());

  const tasksQuery = useMemoFirebase(() => {
    if (!currentUser) return null;
    
    if (currentUser.role === 'admin') {
      return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
    }

    if (currentUser.role === 'employee') {
        return query(
            collection(firestore, 'tasks'),
            where('authorId', '==', currentUser.id),
            orderBy('createdAt', 'desc')
        );
    }

    // Task Manager for Department users: Unified query for their ID, their department, and 'all'
    const groups = [currentUser.id, 'all'];
    if (currentUser.department) {
        groups.push(`dept:${currentUser.department}`);
    }

    return query(
      collection(firestore, 'tasks'), 
      where('recipientIds', 'array-contains-any', groups),
      orderBy('createdAt', 'desc')
    );
  }, [currentUser]);

  const { data: tasksData, isLoading: areTasksLoading } = useCollection<Task>(tasksQuery);
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
    tasks.forEach(task => {
        userIds.add(task.authorId);
        (task.recipientIds || []).forEach(rid => {
            if (!rid.startsWith('dept:') && !['all', 'admins'].includes(rid)) {
                userIds.add(rid);
            }
        });
        task.replies?.forEach(reply => userIds.add(reply.authorId));
    });
    return Array.from(userIds);
  }, [tasks]);

  const { userMap, isLoading: areUsersLoading } = useUserCacheById(allUserIdsInTasks);
  const isLoading = areTasksLoading || areUsersLoading;

  // Calculate Categorized Tasks
  const categorizedTasks = useMemo(() => {
    if (!tasks || !currentUser) return { personal: [], department: [] };

    const personal: Task[] = [];
    const department: Task[] = [];

    // Filter tasks first
    const validTasks = tasks.filter(t => {
      if (t.category !== 'request') return false;
      
      const isIeltsCourse = t.data?.examType === 'ielts_course' || 
                           t.taskType?.toLowerCase() === 'ielts course';
      if (isIeltsCourse) return false;

      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          t.studentName?.toLowerCase().includes(query) ||
          t.taskType?.toLowerCase().includes(query) ||
          t.content?.toLowerCase().includes(query) ||
          t.authorName?.toLowerCase().includes(query) ||
          t.studentPhone?.includes(query)
        );
      }

      return true;
    });

    validTasks.forEach(t => {
      const targets = t.recipientIds || (t.recipientId ? [t.recipientId] : []);
      // Personal tasks are those assigned specifically to this user's ID
      const isDirectlyForMe = targets.includes(currentUser.id);

      if (isDirectlyForMe) {
        personal.push(t);
      } else {
        // Other tasks are those targeted via department group or 'all'
        department.push(t);
      }
    });

    return { personal, department };
  }, [tasks, currentUser, searchQuery]);

  const filteredTasks = taskView === 'personal' ? categorizedTasks.personal : categorizedTasks.department;

  useEffect(() => {
    if (currentUser && filteredTasks.length > 0) {
      const unseenIds = filteredTasks
        .filter(t => t.status === 'new' && !t.viewedBy?.some(v => v.userId === currentUser.id))
        .map(t => t.id);
      
      if (unseenIds.length > 0) {
        markMultipleTasksAsSeen(unseenIds, currentUser.id, currentUser.name);
      }
    }
  }, [filteredTasks, currentUser]);

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

  const newTasks = useMemo(() => filteredTasks.filter(t => t.status === 'new').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const progressTasks = useMemo(() => filteredTasks.filter(t => t.status === 'in-progress').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const completedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'completed').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);
  const deniedTasks = useMemo(() => filteredTasks.filter(t => t.status === 'denied').sort((a,b) => sortByDate(a,b, 'createdAt', 'asc')), [filteredTasks]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{currentUser.role === 'employee' ? 'My Submissions' : 'Task Management'}</CardTitle>
            <CardDescription>
                {currentUser.role === 'employee' 
                    ? 'Track the status of requests you have submitted to management.'
                    : 'Structured FIFO workflow for student requests.'}
            </CardDescription>
          </div>
          <div className="flex flex-col md:flex-row items-center gap-4">
            {currentUser.role !== 'employee' && (
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
                        Other Tasks ({categorizedTasks.department.length})
                    </Button>
                </div>
            )}
            <div className="relative w-full max-sm:max-w-sm">
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
