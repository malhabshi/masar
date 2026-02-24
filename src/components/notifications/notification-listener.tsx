'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent, Student } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useUserCacheById } from '@/hooks/use-user-cache';

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

  const isInitialTaskLoad = useRef(true);
  const isInitialEventLoad = useRef(true);
  const isInitialStudentLoad = useRef(true);

  // Determine if we are allowed to fetch all students
  const canFetchAllStudents = user && ['admin', 'department'].includes(user.role);

  const { data: tasks } = useCollection<Task>(user ? `tasks` : '');
  const { data: events } = useCollection<UpcomingEvent>(user ? `upcoming_events` : '');
  // Only fetch students if the user has the appropriate role
  const { data: students } = useCollection<Student>(canFetchAllStudents ? `students` : '');

  const creatorIds = useMemo(() => students?.map(s => s.createdBy).filter(Boolean) as string[] || [], [students]);
  const { userMap: creatorUserMap, isLoading: creatorsLoading } = useUserCacheById(creatorIds);


  useEffect(() => {
    if (!tasks || !user) return;

    const storageKey = `lastNotifiedTaskTimestamp_${user.id}`;
    const lastNotified = localStorage.getItem(storageKey);

    if (isInitialTaskLoad.current) {
        isInitialTaskLoad.current = false;
        if (!lastNotified) {
             localStorage.setItem(storageKey, new Date().toISOString());
        }
        return;
    }
    
    let newLatestTimestamp = lastNotified || new Date(0).toISOString();
    let didNotify = false;

    tasks.forEach(task => {
      const isNew = new Date(task.createdAt) > new Date(lastNotified || 0);
      const isRelevant = user.role === 'employee' && (task.recipientId === 'all' || task.recipientId === user.id);
      
      if (isNew && isRelevant) {
        if (!didNotify) didNotify = true;
        toast({
          title: 'New Task Assigned',
          description: task.content.substring(0, 50) + '...',
          action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
        });
      }

      if (new Date(task.createdAt) > new Date(newLatestTimestamp)) {
        newLatestTimestamp = task.createdAt;
      }
    });
    
    if (didNotify) {
        playNotificationSound();
    }
    
    localStorage.setItem(storageKey, newLatestTimestamp);

  }, [tasks, user, toast, router]);

  useEffect(() => {
    if (!events || !user) return;
    
    const storageKey = `lastNotifiedEventTimestamp_${user.id}`;
    const lastNotified = localStorage.getItem(storageKey);
    
    if (isInitialEventLoad.current) {
      isInitialEventLoad.current = false;
      if (!lastNotified) {
          localStorage.setItem(storageKey, new Date().toISOString());
      }
      return;
    }
    
    let newLatestTimestamp = lastNotified || new Date(0).toISOString();
    let didNotify = false;

    events.forEach(event => {
      if (new Date(event.createdAt) > new Date(lastNotified || 0)) {
        if (!didNotify) didNotify = true;
        toast({
          title: 'New Event Scheduled',
          description: `${event.title} on ${new Date(event.date).toLocaleDateString()}`,
          action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
        });
      }

      if (new Date(event.createdAt) > new Date(newLatestTimestamp)) {
        newLatestTimestamp = event.createdAt;
      }
    });

    if (didNotify) {
        playNotificationSound();
    }
    
    localStorage.setItem(storageKey, newLatestTimestamp);

  }, [events, user, toast, router]);

  useEffect(() => {
    // The useCollection hook is now guarded, but we double-check here before processing.
    if (!students || !user || creatorsLoading) return;
    if (!['admin', 'department'].includes(user.role)) return;

    const storageKey = `lastNotifiedStudentTimestamp_${user.id}`;
    const lastNotified = localStorage.getItem(storageKey);

    if (isInitialStudentLoad.current) {
        isInitialStudentLoad.current = false;
        if (!lastNotified) {
            localStorage.setItem(storageKey, new Date().toISOString());
        }
        return;
    }

    let newLatestTimestamp = lastNotified || new Date(0).toISOString();
    let didNotify = false;

    students.forEach(student => {
      const isNew = new Date(student.createdAt) > new Date(lastNotified || 0);
      const creator = student.createdBy ? creatorUserMap.get(student.createdBy) : null;
      
      if (isNew && creator && creator.role === 'employee') {
          if (!didNotify) didNotify = true;
          toast({
              title: 'New Student Added',
              description: `'${student.name}' was added by ${creator.name}.`,
              action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
          });
      }

      if (new Date(student.createdAt) > new Date(newLatestTimestamp)) {
        newLatestTimestamp = student.createdAt;
      }
    });

    if(didNotify) {
        playNotificationSound(1200); // Higher pitch for new students
    }

    localStorage.setItem(storageKey, newLatestTimestamp);

  }, [students, user, toast, router, creatorUserMap, creatorsLoading]);


  return null;
}
