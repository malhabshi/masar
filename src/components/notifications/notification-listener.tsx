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
    if (user.role === 'employee' && user.civilId) {
        return [where('employeeId', '==', user.civilId)];
    }
    if (user.role === 'admin' || user.role === 'department') {
        return []; // No constraints for admins/depts, they get all students
    }
    return null; // Not a role that should be listening to students this way
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

  // Effect for new students (for admins) & new documents (for all)
  useEffect(() => {
    if (!students || !user || !userMap.size || !prevStudentsRef.current) {
        prevStudentsRef.current = students;
        return;
    }

    const prevStudentsMap = new Map(prevStudentsRef.current.map(s => [s.id, s]));

    students.forEach(currentStudent => {
        const prevStudent = prevStudentsMap.get(currentStudent.id);
        const isAdminOrDept = ['admin', 'department'].includes(user.role);

        // 1. Check for newly created students
        if (!prevStudent && isAdminOrDept) {
            const creator = userMap.get(currentStudent.createdBy);
            if (creator && creator.role === 'employee') {
                playNotificationSound(1200); // Higher pitch for new students
                toast({
                    title: 'New Student Added',
                    description: `'${currentStudent.name}' was added by ${creator.name}.`,
                    action: <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>View</ToastAction>,
                });
            }
        }

        // 2. Check for new documents on existing students
        if (prevStudent) {
            const isEmployee = user.role === 'employee';
            let wasDocumentAddedForThisUser = false;
            
            // Check if a doc was added FOR an admin/dept
            if (isAdminOrDept && (currentStudent.newDocumentsForAdmin || 0) > (prevStudent.newDocumentsForAdmin || 0)) {
                wasDocumentAddedForThisUser = true;
            }

            // Check if a doc was added FOR an employee
            if (isEmployee && (currentStudent.newDocumentsForEmployee || 0) > (prevStudent.newDocumentsForEmployee || 0)) {
                wasDocumentAddedForThisUser = true;
            }
            
            if (wasDocumentAddedForThisUser) {
                const newDocs = currentStudent.documents.filter(
                    doc => !prevStudent.documents.some(prevDoc => prevDoc.id === doc.id)
                );
                
                if (newDocs.length > 0) {
                    const latestDoc = newDocs[newDocs.length - 1];

                    if (latestDoc.authorId !== user.id) { // Don't notify the uploader
                        const author = userMap.get(latestDoc.authorId);
                        const authorName = author ? author.name : 'A user';
                        const toastTitle = isEmployee ? 'New Document for Your Student' : 'New Document Uploaded';

                        playNotificationSound(900); // Document-specific sound
                        toast({
                            title: toastTitle,
                            description: `${authorName} uploaded a document for ${currentStudent.name}.`,
                            action: (
                                <ToastAction altText="View" onClick={() => router.push(`/student/${currentStudent.id}`)}>
                                    View
                                </ToastAction>
                            ),
                        });
                    }
                }
            }
        }
    });

    prevStudentsRef.current = students;
  }, [students, user, userMap, toast, router]);


  return null;
}
