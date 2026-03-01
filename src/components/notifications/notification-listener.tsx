
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent, Student } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { where, orderBy, collection, query } from 'firebase/firestore';
import { firestore } from '@/firebase';

function playNotificationSound(frequency = 800) {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  
  const audioContext = new window.AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
  gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}


export function NotificationListener() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  const prevTasksRef = useRef<Task[]>();
  const prevEventsRef = useRef<UpcomingEvent[]>();
  const prevStudentsRef = useRef<Student[]>();
  
  const tasksQuery = useMemoFirebase(() => {
    if (!user) return null;
    
    // Admins see all tasks for real-time alerting
    if (user.role === 'admin') {
      return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
    }

    // Employees only listen to tasks they authored
    if (user.role === 'employee') {
        return query(collection(firestore, 'tasks'), where('authorId', '==', user.id));
    }

    // Department users: Real-time alerts for tasks assigned to them, their dept, or 'all'
    const groups = [user.id, 'all'];
    if (user.department) groups.push(`dept:${user.department}`);

    return query(
        collection(firestore, 'tasks'), 
        where('recipientIds', 'array-contains-any', groups)
    );
  }, [user]);

  const { data: tasks } = useCollection<Task>(tasksQuery);

  const eventsQuery = useMemoFirebase(() => {
    if (!user) return null;
    return query(collection(firestore, 'upcoming_events'));
  }, [user]);

  const { data: events } = useCollection<UpcomingEvent>(eventsQuery);

  const studentQuery = useMemoFirebase(() => {
    if (!user) return null;
    const isAdminDept = user.role === 'admin' || user.role === 'department';
    const isEmployee = user.role === 'employee';
    const hasCivilId = !!user.civilId;

    if (isAdminDept) {
        return query(collection(firestore, 'students'), orderBy('createdAt', 'desc'));
    }
    
    if (isEmployee && hasCivilId) {
        return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    }
    
    return null; 
  }, [user?.civilId, user?.role, user?.id]);

  const { data: students } = useCollection<Student>(studentQuery);

  const allUserIds = useMemo(() => {
    const ids = new Set<string>();
    (tasks || []).forEach(task => {
      ids.add(task.authorId);
      task.replies?.forEach(reply => ids.add(reply.authorId));
    });
    (events || []).forEach(event => ids.add(event.authorId));
    (students || []).forEach(student => {
      if (student.createdBy) ids.add(student.createdBy);
      student.documents?.forEach(doc => ids.add(doc.authorId));
      if (student.deletionRequested?.requestedBy) {
        ids.add(student.deletionRequested.requestedBy);
      }
    });
    return Array.from(ids);
  }, [tasks, events, students]);

  const { userMap } = useUserCacheById(allUserIds);

  useEffect(() => {
    if (!tasks || !user || !prevTasksRef.current) {
        prevTasksRef.current = tasks || [];
        return;
    }
    const prevTaskIds = new Set(prevTasksRef.current.map(t => t.id));
    tasks.forEach(task => {
        if (!prevTaskIds.has(task.id) && task.authorId !== user.id) {
            playNotificationSound();
            toast({
                title: 'New Task/Update Received',
                description: task.content.substring(0, 50) + '...',
                action: <ToastAction altText="View" onClick={() => router.push('/tasks')}>View</ToastAction>,
            });
        }
    });
    prevTasksRef.current = tasks;
  }, [tasks, user, toast, router]);

  useEffect(() => {
    if (!events || !user || !prevEventsRef.current) {
        prevEventsRef.current = events || [];
        return;
    }
    const prevEventIds = new Set(prevEventsRef.current.map(e => e.id));
    events.forEach(event => {
        if (!prevEventIds.has(event.id)) {
            playNotificationSound();
            toast({
                title: 'New Event Scheduled',
                description: `${event.title} on ${new Date(event.date).toLocaleDateString()}`,
                action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
            });
        }
    });
    prevEventsRef.current = events;
  }, [events, user, toast, router]);

  useEffect(() => {
    if (!students || !user || !userMap.size || isUserLoading) {
        return;
    }
    if (!prevStudentsRef.current) {
        prevStudentsRef.current = students;
        return;
    }
    
    const prevStudentsMap = new Map(prevStudentsRef.current.map(s => [s.id, s]));
    
    students.forEach(currentStudent => {
        const prevStudent = prevStudentsMap.get(currentStudent.id);

        if (!prevStudent) {
            const isAdmin = user.role === 'admin';
            const creator = userMap.get(currentStudent.createdBy);
            
            if (isAdmin && creator && creator.id !== user.id) {
                playNotificationSound(1200);
                toast({
                    title: 'New Unassigned Student',
                    description: `'${currentStudent.name}' was added by ${creator.name}.`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/unassigned-students`)}>View</ToastAction>,
                });
            }
            return;
        }

        const prevDocIds = new Set((prevStudent.documents || []).map(d => d.id));
        const newDocs = (currentStudent.documents || []).filter(d => !prevDocIds.has(d.id));
        if (newDocs.length > 0) {
            const newDoc = newDocs[newDocs.length - 1]; 
            const uploader = userMap.get(newDoc.authorId);
            
            if (uploader && uploader.id !== user.id) {
                playNotificationSound();
                toast({
                    title: 'New Document Received',
                    description: `${uploader.name} uploaded a document for ${currentStudent.name}.`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                });
            }
        }
        
        if (!prevStudent.deletionRequested && currentStudent.deletionRequested?.status === 'pending') {
            const isAdminOrDept = ['admin', 'department'].includes(user.role);
            const requester = userMap.get(currentStudent.deletionRequested.requestedBy);
            if (isAdminOrDept && requester) {
                playNotificationSound(1400);
                toast({
                    title: 'Deletion Request',
                    description: `${requester.name} has requested to delete student: ${currentStudent.name}`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                    variant: 'destructive',
                    duration: 10000,
                });
            }
        }
    });

    prevStudentsRef.current = students;
  }, [students, user, userMap, toast, router, isUserLoading]);


  return null;
}
