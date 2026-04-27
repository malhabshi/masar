'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent, Student, Country } from '@/lib/types';
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
  // Increased from 0.05 to 0.3 for a more noticeable alert sound
  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.00001, audioContext.currentTime + 0.5);
  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.5);
}

// Helper to check if a student is assigned to a department based on their applications
function isStudentInUserDepartment(student: Student, userDept?: string): boolean {
  if (!userDept) return false;
  const countries = (student.applications || []).map(a => a.country);
  if (userDept === 'UK') return countries.includes('UK');
  if (userDept === 'USA') return countries.includes('USA');
  if (userDept === 'AU/NZ') return countries.includes('Australia') || countries.includes('New Zealand');
  return false;
}

export function NotificationListener() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  const prevTasksRef = useRef<Task[]>();
  const prevEventsRef = useRef<UpcomingEvent[]>();
  const prevStudentsRef = useRef<Student[]>();
  
  // Use a session marker to ignore everything older than the page load on the very first snapshot
  const sessionStartTime = useRef(new Date().toISOString());

  const tasksQuery = useMemoFirebase(() => {
    if (!user) return null;
    if (user.role === 'admin') return query(collection(firestore, 'tasks'), orderBy('createdAt', 'desc'));
    
    // Correctly match targeted tasks for employees and departments
    const groups = [user.id, 'all'];
    if (user.department) groups.push(`dept:${user.department}`);
    return query(collection(firestore, 'tasks'), where('recipientIds', 'array-contains-any', groups));
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
    if (isAdminDept) return query(collection(firestore, 'students'), orderBy('createdAt', 'desc'));
    if (isEmployee && user.civilId) return query(collection(firestore, 'students'), where('employeeId', '==', user.civilId));
    return null; 
  }, [user?.civilId, user?.role]);

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
      if (student.deletionRequested?.requestedBy) ids.add(student.deletionRequested.requestedBy);
    });
    return Array.from(ids);
  }, [tasks, events, students]);

  const { userMap } = useUserCacheById(allUserIds);

  // 1. Task Notifications
  useEffect(() => {
    if (!tasks || !user) return;

    const storageKey = `lastViewedTasks_${user.id}`;
    const lastViewed = localStorage.getItem(storageKey);
    const cutOffTime = lastViewed || sessionStartTime.current;

    if (!prevTasksRef.current) {
        prevTasksRef.current = tasks;
        return;
    }

    const prevTaskIds = new Set(prevTasksRef.current.map(t => t.id));
    tasks.forEach(task => {
        // Only toast if item is genuinely new AND created after the last time we viewed the list
        if (!prevTaskIds.has(task.id) && task.authorId !== user.id && task.createdAt > cutOffTime) {
            // Filter: If task has specific recipients and I'm not one of them, don't show toast
            // (Even for admins, to avoid noise if management transfers students)
            const myIds = [user.id, 'all'];
            if (user.department) myIds.push(`dept:${user.department}`);
            
            const isForMe = task.recipientIds?.some(id => myIds.includes(id)) || task.recipientId === user.id || task.recipientId === 'all';
            
            if (!isForMe && user.role !== 'admin') return; 
            // If I'm an admin, I still might want to see them? 
            // The user says 'all employee is notified'.
            
            if (!isForMe) return;

            if (user.role === 'department' && task.studentId && students) {
              const student = students.find(s => s.id === task.studentId);
              if (student && !isStudentInUserDepartment(student, user.department)) return;
            }
            
            playNotificationSound();
            toast({
                title: 'New Task/Update Received',
                description: task.content.substring(0, 50) + '...',
                action: <ToastAction altText="View" onClick={() => router.push('/tasks')}>View</ToastAction>,
            });
        }
    });
    prevTasksRef.current = tasks;
  }, [tasks, user, toast, router, students]);

  // 2. Event Notifications
  useEffect(() => {
    if (!events || !user) return;

    const storageKey = `lastViewedEvents_${user.id}`;
    const lastViewed = localStorage.getItem(storageKey);
    const cutOffTime = lastViewed || sessionStartTime.current;

    if (!prevEventsRef.current) {
        prevEventsRef.current = events;
        return;
    }

    const prevEventIds = new Set(prevEventsRef.current.map(e => e.id));
    events.forEach(event => {
        // Only toast if created after last session/view
        if (!prevEventIds.has(event.id) && event.createdAt > cutOffTime) {
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

  // 3. Student/Document Notifications
  useEffect(() => {
    if (!students || !user || !userMap.size || isUserLoading) return;
    if (!prevStudentsRef.current) {
        prevStudentsRef.current = students;
        return;
    }
    
    const prevStudentsMap = new Map(prevStudentsRef.current.map(s => [s.id, s]));
    
    students.forEach(currentStudent => {
        const prevStudent = prevStudentsMap.get(currentStudent.id);
        const isMyDept = user.role === 'admin' || isStudentInUserDepartment(currentStudent, user.department);

        if (!prevStudent) {
            // Only toast for truly new students added since we started the session
            if (user.role === 'admin' && currentStudent.createdBy !== user.id && currentStudent.createdAt > sessionStartTime.current) {
                const creator = userMap.get(currentStudent.createdBy);
                playNotificationSound(1200);
                toast({
                    title: 'New Unassigned Student',
                    description: `'${currentStudent.name}' was added by ${creator?.name || 'Staff'}.`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/unassigned-students`)}>View</ToastAction>,
                });
            } else if (user.role === 'employee' && (currentStudent.lastActivityAt || currentStudent.createdAt) > sessionStartTime.current) {
                // For employees: Trigger when a student is newly assigned to them
                playNotificationSound(1000);
                toast({
                    title: 'Student Assigned',
                    description: `You have been assigned a new student: '${currentStudent.name}'`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                });
            }
            return;
        }

        // 4. CHAT NOTIFICATIONS (Check unread counters)
        const role = user.role;
        const prevUnread = role === 'employee' ? (prevStudent.employeeUnreadMessages || 0) : (prevStudent.chatUnreadCountByUser?.[user.id] || 0);
        const currentUnread = role === 'employee' ? (currentStudent.employeeUnreadMessages || 0) : (currentStudent.chatUnreadCountByUser?.[user.id] || 0);

        // Trigger if unread count increased since the last snapshot
        if (currentUnread > prevUnread) {
            playNotificationSound(900);
            toast({
                title: 'New Message',
                description: `You have a new internal chat message for ${currentStudent.name}.`,
                action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>Open Chat</ToastAction>,
            });
        }

        if (!isMyDept) return;

        const prevDocIds = new Set((prevStudent.documents || []).map(d => d.id));
        const newDocs = (currentStudent.documents || []).filter(d => !prevDocIds.has(d.id));
        
        if (newDocs.length > 0) {
            const newDoc = newDocs[newDocs.length - 1]; 
            const uploader = userMap.get(newDoc.authorId);
            // Only toast if document was uploaded after we loaded the page
            if (uploader && uploader.id !== user.id && newDoc.uploadedAt > sessionStartTime.current) {
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
            // Only toast if the request happened after session start
            if (isAdminOrDept && requester && currentStudent.deletionRequested.requestedAt > sessionStartTime.current) {
                playNotificationSound(1400);
                toast({
                    title: 'Deletion Request',
                    description: `${requester.name} requested to delete: ${currentStudent.name}`,
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
