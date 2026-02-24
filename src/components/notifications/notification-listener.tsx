'use client';

import { useEffect, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ToastAction } from '@/components/ui/toast';

function playNotificationSound() {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  
  const audioContext = new window.AudioContext();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
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

  const { data: tasks } = useCollection<Task>(user ? `tasks` : '');
  const { data: events } = useCollection<UpcomingEvent>(user ? `upcoming_events` : '');

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
      if (new Date(event.date) > new Date(lastNotified || 0)) {
        if (!didNotify) didNotify = true;
        toast({
          title: 'New Event Scheduled',
          description: `${event.title} on ${new Date(event.date).toLocaleDateString()}`,
          action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
        });
      }

      if (new Date(event.date) > new Date(newLatestTimestamp)) {
        newLatestTimestamp = event.date;
      }
    });

    if (didNotify) {
        playNotificationSound();
    }
    
    localStorage.setItem(storageKey, newLatestTimestamp);

  }, [events, user, toast, router]);


  return null;
}
