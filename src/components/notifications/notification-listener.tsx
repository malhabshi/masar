'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection, useMemoFirebase } from '@/firebase';
import { useToast } from '@/hooks/use-toast';
import type { Task, UpcomingEvent, Student } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { ToastAction } from '@/components/ui/toast';
import { useUsers } from '@/contexts/users-provider';
import { where, collection, query, doc, getDoc } from 'firebase/firestore';
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

/**
 * Pops a toast (and a beep) when something happens while the user has the app open.
 *
 * Mounted on every page. It used to subscribe to the ENTIRE tasks collection (27k
 * documents) and EVERY student (2k) for admins, on every load and refresh, only to
 * diff snapshots for new arrivals — that download took minutes on a Kuwait connection.
 * Every query here now asks the database only for what can produce a toast: tasks
 * created after the page opened, and students touched after the page opened. Between
 * them that is a few dozen documents instead of thirty thousand.
 *
 * Names of the people involved (who uploaded, who created, who requested) are fetched
 * on demand when an event fires, rather than kept in a map built from the whole
 * database, so a toast never depends on that person having been seen earlier.
 */
export function NotificationListener() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const router = useRouter();
  const { fetchUsersById } = useUsers();

  // Everything older than this moment is history, not news. Set two minutes into the
  // past so a browser clock slightly ahead of the server cannot hide the first events
  // after load; anything inside that window lands in the first snapshot, which is only
  // ever used as the baseline and never announced.
  const sessionStart = useRef(new Date(Date.now() - 2 * 60 * 1000).toISOString());

  const role = user?.role;
  const civilId = user?.civilId;
  const active = !!user && role !== 'adminplus';
  const isManagement = role === 'admin' || role === 'department';
  const isEmployee = role === 'employee';

  const nameOf = (userId: string | undefined, fallback: string) =>
    userId ? fetchUsersById([userId]).then(m => m.get(userId)?.name || fallback).catch(() => fallback) : Promise.resolve(fallback);

  // Tasks created since the page opened. Any signed-in user may list tasks, and who a
  // task is for is decided below exactly as before.
  const tasksQuery = useMemoFirebase(() => {
    if (!active) return null;
    return query(collection(firestore, 'tasks'), where('createdAt', '>', sessionStart.current));
  }, [active]);
  // Each hook hands back an empty list until its first snapshot lands. A baseline taken
  // from that placeholder would make the whole first snapshot look "new", so every
  // effect below waits for the loading flag to clear before it records a baseline.
  const { data: tasks, isLoading: tasksLoading } = useCollection<Task>(tasksQuery);

  const eventsQuery = useMemoFirebase(() => {
    if (!active) return null;
    return query(collection(firestore, 'upcoming_events'));
  }, [active]);
  const { data: events, isLoading: eventsLoading } = useCollection<UpcomingEvent>(eventsQuery);

  // Management: every student touched since the page opened. Creating a student, a
  // chat message, a document upload (either section) and a deletion request all bump
  // lastActivityAt, so this one small list (about a hundred a day) carries every
  // change the toasts below need, exactly as the full list did.
  const recentStudentsQuery = useMemoFirebase(() => {
    if (!active || !isManagement) return null;
    return query(collection(firestore, 'students'), where('lastActivityAt', '>', sessionStart.current));
  }, [active, isManagement]);
  const { data: recentStudents, isLoading: recentLoading } = useCollection<Student>(recentStudentsQuery);

  // Employee: their own portfolio. The sidebar already holds this exact query, and the
  // SDK shares one listener between identical queries, so it costs nothing extra.
  const portfolioQuery = useMemoFirebase(() => {
    if (!active || !isEmployee || !civilId) return null;
    return query(collection(firestore, 'students'), where('employeeId', '==', civilId));
  }, [active, isEmployee, civilId]);
  const { data: portfolio, isLoading: portfolioLoading } = useCollection<Student>(portfolioQuery);

  // Whatever students happen to be loaded, for department checks without a round trip.
  const knownStudents = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of recentStudents || []) map.set(s.id, s);
    for (const s of portfolio || []) map.set(s.id, s);
    return map;
  }, [recentStudents, portfolio]);

  // 1. Task notifications
  const prevTasksRef = useRef<Set<string>>();
  useEffect(() => {
    if (!tasks || !user || tasksLoading) return;

    const storageKey = `lastViewedTasks_${user.id}`;
    const lastViewed = localStorage.getItem(storageKey);
    const cutOffTime = lastViewed || sessionStart.current;

    if (!prevTasksRef.current) {
      prevTasksRef.current = new Set(tasks.map(t => t.id));
      return;
    }

    const announce = (task: Task) => {
      playNotificationSound();
      toast({
        title: 'New Task/Update Received',
        description: task.content.substring(0, 50) + '...',
        action: <ToastAction altText="View" onClick={() => router.push('/tasks')}>View</ToastAction>,
      });
    };

    const prevTaskIds = prevTasksRef.current;
    tasks.forEach(task => {
      if (prevTaskIds.has(task.id) || task.authorId === user.id || task.createdAt <= cutOffTime) return;

      const myIds = [user.id, 'all'];
      if (user.department) myIds.push(`dept:${user.department}`);
      const inRecipients = !!task.recipientIds?.some(id => myIds.includes(id));
      // Employees and departments used to be served by a recipientIds query, so a task
      // with an empty recipientIds list never reached them; keep it that way. Admins
      // saw everything and also honoured the legacy single recipientId field.
      const isForMe = user.role === 'admin'
        ? inRecipients || task.recipientId === user.id || task.recipientId === 'all'
        : inRecipients;
      if (!isForMe) return;

      if (user.role === 'department' && task.studentId) {
        // A department only hears about students in its own countries. The student is
        // usually not in the small loaded set yet (the task is written before the
        // student's activity stamp), so look it up; a missing student never blocked
        // the toast before and does not now.
        const known = knownStudents.get(task.studentId);
        if (known) {
          if (isStudentInUserDepartment(known, user.department)) announce(task);
          return;
        }
        getDoc(doc(firestore, 'students', task.studentId))
          .then(snap => {
            const s = snap.exists() ? (snap.data() as Student) : undefined;
            if (!s || isStudentInUserDepartment(s, user.department)) announce(task);
          })
          .catch(() => announce(task));
        return;
      }

      announce(task);
    });
    prevTasksRef.current = new Set(tasks.map(t => t.id));
  }, [tasks, tasksLoading, user, toast, router, knownStudents]);

  // 2. Event notifications
  const prevEventsRef = useRef<Set<string>>();
  useEffect(() => {
    if (!events || !user || eventsLoading) return;

    const storageKey = `lastViewedEvents_${user.id}`;
    const lastViewed = localStorage.getItem(storageKey);
    const cutOffTime = lastViewed || sessionStart.current;

    if (!prevEventsRef.current) {
      prevEventsRef.current = new Set(events.map(e => e.id));
      return;
    }

    const prevEventIds = prevEventsRef.current;
    events.forEach(event => {
      if (!prevEventIds.has(event.id) && event.createdAt > cutOffTime) {
        playNotificationSound();
        toast({
          title: 'New Event Scheduled',
          description: `${event.title} on ${new Date(event.date).toLocaleDateString()}`,
          action: <ToastAction altText="View" onClick={() => router.push('/dashboard')}>View</ToastAction>,
        });
      }
    });
    prevEventsRef.current = new Set(events.map(e => e.id));
  }, [events, eventsLoading, user, toast, router]);

  // 3. New unassigned student (admin)
  const prevNewStudentsRef = useRef<Set<string>>();
  useEffect(() => {
    if (!recentStudents || !user || user.role !== 'admin' || isUserLoading || recentLoading) return;
    if (!prevNewStudentsRef.current) {
      prevNewStudentsRef.current = new Set(recentStudents.map(s => s.id));
      return;
    }
    const seen = prevNewStudentsRef.current;
    recentStudents.forEach(student => {
      if (seen.has(student.id) || student.createdBy === user.id) return;
      // The list also holds existing students with fresh activity; only births count.
      if (student.createdAt <= sessionStart.current) return;
      nameOf(student.createdBy, 'Staff').then(creator => {
        playNotificationSound(1200);
        toast({
          title: 'New Unassigned Student',
          description: `'${student.name}' was added by ${creator}.`,
          action: <ToastAction altText="View" onClick={() => router.push('/unassigned-students')}>View</ToastAction>,
        });
      });
    });
    prevNewStudentsRef.current = new Set(recentStudents.map(s => s.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentStudents, recentLoading, user, toast, router, isUserLoading]);

  // 4. Student assigned to me (employee)
  const prevPortfolioRef = useRef<Set<string>>();
  useEffect(() => {
    if (!portfolio || !user || isUserLoading || portfolioLoading) return;
    if (!prevPortfolioRef.current) {
      prevPortfolioRef.current = new Set(portfolio.map(s => s.id));
      return;
    }
    const seen = prevPortfolioRef.current;
    portfolio.forEach(student => {
      if (seen.has(student.id)) return;
      if ((student.lastActivityAt || student.createdAt) > sessionStart.current) {
        playNotificationSound(1000);
        toast({
          title: 'Student Assigned',
          description: `You have been assigned a new student: '${student.name}'`,
          action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
        });
      }
    });
    prevPortfolioRef.current = new Set(portfolio.map(s => s.id));
  }, [portfolio, portfolioLoading, user, toast, router, isUserLoading]);

  // 5. New chat message. Management watches its own unread counter on each student;
  //    employees watch employeeUnreadMessages across their portfolio.
  //    A student seen for the first time counts only for management, and only when the
  //    latest message is newer than the page — so an old unread thread does not announce
  //    itself when the student shows up for some unrelated reason, and a student just
  //    transferred to an employee announces "Student Assigned" alone, as before.
  const chatSource = isEmployee ? portfolio : recentStudents;
  const chatLoading = isEmployee ? portfolioLoading : recentLoading;
  const prevUnreadRef = useRef<Map<string, number>>();
  useEffect(() => {
    if (!chatSource || !user || isUserLoading || chatLoading) return;
    const countOf = (s: Student) => isEmployee ? (s.employeeUnreadMessages || 0) : (s.chatUnreadCountByUser?.[user.id] || 0);
    const current = new Map(chatSource.map(s => [s.id, countOf(s)] as const));

    if (!prevUnreadRef.current) {
      prevUnreadRef.current = current;
      return;
    }
    const prev = prevUnreadRef.current;
    chatSource.forEach(student => {
      const wasKnown = prev.has(student.id);
      const grew = countOf(student) > (prev.get(student.id) || 0);
      const fresh = (student.lastChatMessageTimestamp || '') > sessionStart.current;
      if (grew && (wasKnown || (!isEmployee && fresh))) {
        playNotificationSound(900);
        toast({
          title: 'New Message',
          description: `You have a new internal chat message for ${student.name}.`,
          action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>Open Chat</ToastAction>,
        });
      }
    });
    prevUnreadRef.current = current;
  }, [chatSource, chatLoading, user, isEmployee, toast, router, isUserLoading]);

  // 6. New document (management). A student enters this list when a document arrives;
  //    the upload time keeps old documents from re-announcing themselves, and a student
  //    created during the session is not announced for the documents they were born
  //    with (JotForm attaches the application PDF and passport at creation).
  const prevDocsRef = useRef<Map<string, Set<string>>>();
  useEffect(() => {
    if (!recentStudents || !user || !isManagement || isUserLoading || recentLoading) return;
    const current = new Map(recentStudents.map(s => [s.id, new Set((s.documents || []).map(d => d.id))] as const));

    if (!prevDocsRef.current) {
      prevDocsRef.current = current;
      return;
    }
    const prev = prevDocsRef.current;
    recentStudents.forEach(student => {
      const isMyDept = user.role === 'admin' || isStudentInUserDepartment(student, user.department);
      if (!isMyDept) return;

      const firstSighting = !prev.has(student.id);
      if (firstSighting && student.createdAt > sessionStart.current) return;

      const prevIds = prev.get(student.id) || new Set<string>();
      const newDocs = (student.documents || []).filter(d => !prevIds.has(d.id));
      if (newDocs.length === 0) return;

      const newDoc = newDocs[newDocs.length - 1];
      if (newDoc.uploadedAt <= sessionStart.current) return;

      if (newDoc.authorId === 'student-self-upload') {
        playNotificationSound();
        toast({
          title: 'Student Uploaded a Document',
          description: `${student.name} submitted a document via upload link.`,
          action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
          className: 'border-green-500',
        });
      } else if (newDoc.authorId !== user.id) {
        nameOf(newDoc.authorId, 'Staff').then(uploader => {
          playNotificationSound();
          toast({
            title: 'New Document Received',
            description: `${uploader} uploaded a document for ${student.name}.`,
            action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
          });
        });
      }
    });
    prevDocsRef.current = current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentStudents, recentLoading, user, isManagement, toast, router, isUserLoading]);

  // 7. Deletion request (management, own department only). Keyed by the request time
  //    so a student already in the list still announces a request made later.
  const prevDeletionRef = useRef<Map<string, string>>();
  useEffect(() => {
    if (!recentStudents || !user || !isManagement || isUserLoading || recentLoading) return;
    const current = new Map(recentStudents.map(s => [s.id, s.deletionRequested?.requestedAt || ''] as const));

    if (!prevDeletionRef.current) {
      prevDeletionRef.current = current;
      return;
    }
    const prev = prevDeletionRef.current;
    recentStudents.forEach(student => {
      const req = student.deletionRequested;
      if (!req || req.status !== 'pending' || req.requestedAt <= sessionStart.current) return;
      if (prev.get(student.id) === req.requestedAt) return;
      const isMyDept = user.role === 'admin' || isStudentInUserDepartment(student, user.department);
      if (!isMyDept) return;
      nameOf(req.requestedBy, 'An employee').then(requester => {
        playNotificationSound(1400);
        toast({
          title: 'Deletion Request',
          description: `${requester} requested to delete: ${student.name}`,
          action: <ToastAction altText="View" onClick={() => router.push(`/student/${student.id}`)}>View</ToastAction>,
          variant: 'destructive',
          duration: 10000,
        });
      });
    });
    prevDeletionRef.current = current;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentStudents, recentLoading, user, isManagement, toast, router, isUserLoading]);

  return null;
}
