
'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent, Student } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { where } from 'firebase/firestore';

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
  const { user } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  const prevTasksRef = useRef<Task[]>();
  const prevEventsRef = useRef<UpcomingEvent[]>();
  const prevStudentsRef = useRef<Student[]>();

  const { data: tasks } = useCollection<Task>(user ? `tasks` : '');
  const { data: events } = useCollection<UpcomingEvent>(user ? `upcoming_events` : '');

  // Fetch students based on user role
  const studentQueryConstraints = useMemoFirebase(() => {
    if (!user) return null;
    if (user.role === 'admin' || user.role === 'department') {
        return []; // No constraints for admins/depts, they get all students
    }
    return null; // Not a role that should be listening to students this way
  }, [user?.role]);

  const { data: students } = useCollection<Student>(
    studentQueryConstraints ? 'students' : '', 
    ...(studentQueryConstraints || [])
  );

  // Cache all user profiles needed for notifications
  const allUserIds = useMemo(() => {
    const ids = new Set<string>();
    (tasks || []).forEach(task => {
      ids.add(task.authorId);
      task.replies?.forEach(reply => ids.add(reply.authorId));
    });
    (events || []).forEach(event => ids.add(event.authorId));
    (students || []).forEach(student => {
      if (student.createdBy) ids.add(student.createdBy);
    });
    return Array.from(ids);
  }, [tasks, events, students]);

  const { userMap } = useUserCacheById(allUserIds);

  // Effect for new tasks
  useEffect(() => {
    if (!tasks || !user || !prevTasksRef.current) {
        prevTasksRef.current = tasks;
        return;
    }
    const prevTaskIds = new Set(prevTasksRef.current.map(t => t.id));
    tasks.forEach(task => {
        if (!prevTaskIds.has(task.id)) {
            const isRelevant = user.role === 'employee' && (task.recipientId === 'all' || task.recipientId === user.id);
            if (isRelevant) {
                playNotificationSound();
                toast({
                    title: 'New Task Assigned',
                    description: task.content.substring(0, 50) + '...',
                    action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
                });
            }
        }
    });
    prevTasksRef.current = tasks;
  }, [tasks, user, toast, router]);

  // Effect for new events
  useEffect(() => {
    if (!events || !user || !prevEventsRef.current) {
        prevEventsRef.current = events;
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

  // Effect for new students (for admins)
  useEffect(() => {
    if (!students || !user || !userMap.size || !prevStudentsRef.current) {
        prevStudentsRef.current = students;
        return;
    }
    const prevStudentIds = new Set(prevStudentsRef.current.map(s => s.id));
    students.forEach(student => {
        if (!prevStudentIds.has(student.id)) {
            const isAdminOrDept = ['admin', 'department'].includes(user.role);
            if (isAdminOrDept) {
                const creator = userMap.get(student.createdBy);
                if (creator && creator.role === 'employee') {
                    playNotificationSound(1200); // Higher pitch
                    toast({
                        title: 'New Student Added',
                        description: `'${student.name}' was added by ${creator.name}.`,
                        action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
                    });
                }
            }
        }
    });
    prevStudentsRef.current = students;
  }, [students, user, userMap, toast, router]);


  return null;
}
