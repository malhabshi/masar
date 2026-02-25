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
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const router = useRouter();

  const prevTasksRef = useRef<Task[]>();
  const prevEventsRef = useRef<UpcomingEvent[]>();
  const prevStudentsRef = useRef<Student[]>();
  
  // Minimal console log as requested
  useEffect(() => {
    if (user) {
      console.log('👂 Notification Listener is running for user:', user.email, 'role:', user.role);
    }
  }, [user]);

  const { data: tasks } = useCollection<Task>(user ? `tasks` : '');
  const { data: events } = useCollection<UpcomingEvent>(user ? `upcoming_events` : '');

  // Fetch students based on user role
  const studentQueryConstraints = useMemoFirebase(() => {
    if (!user) return null;
    // Admins and departments get all students to listen for new student creation.
    if (user.role === 'admin' || user.role === 'department') {
        return [];
    }
    // Employees will get their own students to listen for document uploads from admins.
    if (user.role === 'employee' && user.civilId) {
        return [where('employeeId', '==', user.civilId)];
    }
    return null; 
  }, [user?.role, user?.civilId]);

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
      // We also need authors of documents to check who uploaded it
      student.documents?.forEach(doc => ids.add(doc.authorId));
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

  // Effect for new students and document uploads
  useEffect(() => {
    if (!students || !user || !userMap.size || isUserLoading) {
        return;
    }
    // Set initial state without triggering notifications
    if (!prevStudentsRef.current) {
        prevStudentsRef.current = students;
        return;
    }
    
    const prevStudentsMap = new Map(prevStudentsRef.current.map(s => [s.id, s]));
    
    students.forEach(currentStudent => {
        const prevStudent = prevStudentsMap.get(currentStudent.id);

        // --- New Student Creation Notification ---
        if (!prevStudent) {
            const isAdminOrDept = ['admin', 'department'].includes(user.role);
            if (isAdminOrDept) {
                const creator = userMap.get(currentStudent.createdBy);
                if (creator && creator.role === 'employee') {
                    console.log(`✅ NOTIFICATION: Triggering 'New Student' for admin ${user.email}`);
                    playNotificationSound(1200);
                    toast({
                        title: 'New Student Added',
                        description: `'${currentStudent.name}' was added by ${creator.name}.`,
                        action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                    });
                }
            }
            return; // Stop further processing for new students
        }


        // --- New Document Upload Notification ---
        const isEmployee = user.role === 'employee';
        const isAdminOrDept = ['admin', 'department'].includes(user.role);

        // Check if an employee should be notified
        const newDocsForEmployee = currentStudent.newDocumentsForEmployee || 0;
        const prevDocsForEmployee = prevStudent.newDocumentsForEmployee || 0;
        
        if (isEmployee && newDocsForEmployee > prevDocsForEmployee) {
            console.log(`📊 Student data changed for employee: ${currentStudent.id}. Counter is now ${newDocsForEmployee}. Previously ${prevDocsForEmployee}`);
            // More robustly find the new document(s)
            const prevDocIds = new Set((prevStudent.documents || []).map(d => d.id));
            const newDocs = (currentStudent.documents || []).filter(d => !prevDocIds.has(d.id));

            if (newDocs.length > 0) {
                const newDoc = newDocs[newDocs.length - 1]; // Notify for the latest one
                const uploader = userMap.get(newDoc.authorId);
                
                // Don't notify the uploader
                if (uploader && uploader.id !== user.id) {
                    console.log(`✅ NOTIFICATION: Triggering 'New Document' for employee ${user.email}`);
                    playNotificationSound();
                    toast({
                        title: 'New Document Received',
                        description: `${uploader.name} uploaded a document for ${currentStudent.name}.`,
                        action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                    });
                }
            }
        }

        // Check if an admin/dept should be notified
        const newDocsForAdmin = currentStudent.newDocumentsForAdmin || 0;
        const prevDocsForAdmin = prevStudent.newDocumentsForAdmin || 0;
        if (isAdminOrDept && newDocsForAdmin > prevDocsForAdmin) {
            console.log(`📊 Student data changed for admin: ${currentStudent.id}. Counter is now ${newDocsForAdmin}. Previously ${prevDocsForAdmin}`);
            const prevDocIds = new Set((prevStudent.documents || []).map(d => d.id));
            const newDocs = (currentStudent.documents || []).filter(d => !prevDocIds.has(d.id));
            
            if (newDocs.length > 0) {
                const newDoc = newDocs[newDocs.length - 1];
                const uploader = userMap.get(newDoc.authorId);

                if (uploader && uploader.id !== user.id) {
                    console.log(`✅ NOTIFICATION: Triggering 'New Document' for admin ${user.email}`);
                    playNotificationSound();
                    toast({
                        title: 'New Document Uploaded',
                        description: `${uploader.name} uploaded a document for ${currentStudent.name}.`,
                        action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                    });
                }
            }
        }
    });

    prevStudentsRef.current = students;
  }, [students, user, userMap, toast, router, isUserLoading]);


  return null;
}
