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

  // Everything older than this moment is history, not news. Set well into the past so a
  // browser clock running ahead of the server cannot hide the first events of the
  // session: the times being compared are written by the server, and a staff PC ten
  // minutes fast would otherwise filter out its own new documents. A generous window is
  // free — whatever lands in the first snapshot becomes the baseline and is never
  // announced (the one deliberate exception is the catch-up below).
  const sessionStart = useRef(new Date(Date.now() - 10 * 60 * 1000).toISOString());

  // Catch-up: tasks and events addressed to you since you last looked at the update
  // feed are announced once, on arrival of the first snapshot — that is what the old
  // listener did (it diffed against an empty baseline), and staff rely on it when they
  // open the app from a WhatsApp link rather than the dashboard. Capped at seven days
  // so a long absence cannot drag in thousands of documents or a wall of beeps.
  const catchUpFloor = useRef(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
  const since = (key: string | null) => {
    if (typeof window === 'undefined' || !key) return sessionStart.current;
    const lastViewed = window.localStorage.getItem(key);
    if (!lastViewed) return sessionStart.current;
    return lastViewed > catchUpFloor.current ? lastViewed : catchUpFloor.current;
  };

  const role = user?.role;
  const civilId = user?.civilId;
  const active = !!user && role !== 'adminplus';
  const isManagement = role === 'admin' || role === 'department';
  const isEmployee = role === 'employee';

  const nameOf = (userId: string | undefined, fallback: string) =>
    userId ? fetchUsersById([userId]).then(m => m.get(userId)?.name || fallback).catch(() => fallback) : Promise.resolve(fallback);

  // Tasks created since the page opened, or since the user last read the update feed,
  // whichever is earlier. Any signed-in user may list tasks, and who a task is for is
  // decided below exactly as before.
  const taskFloor = useRef<string | null>(null);
  if (taskFloor.current === null && user) {
    const catchUp = since(`lastViewedTasks_${user.id}`);
    taskFloor.current = catchUp < sessionStart.current ? catchUp : sessionStart.current;
  }
  const tasksQuery = useMemoFirebase(() => {
    if (!active || !taskFloor.current) return null;
    return query(collection(firestore, 'tasks'), where('createdAt', '>', taskFloor.current));
  }, [active, taskFloor.current]);
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

  // Management's current chat backlog. This is the baseline for the "New Message" toast:
  // without it a student already carrying unread messages for me would announce itself
  // the moment anything else touched that student — including a message addressed to
  // someone else. The sidebar holds this identical query, so the SDK shares one listener
  // and it costs nothing extra.
  const chatBacklogQuery = useMemoFirebase(() => {
    if (!active || !isManagement || !user) return null;
    return query(collection(firestore, 'students'), where(`chatUnreadCountByUser.${user.id}`, '>', 0));
  }, [active, isManagement, user?.id]);
  const { data: chatBacklog, isLoading: backlogLoading } = useCollection<Student>(chatBacklogQuery);

  // Whatever students happen to be loaded, for department checks without a round trip.
  const knownStudents = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of recentStudents || []) map.set(s.id, s);
    for (const s of portfolio || []) map.set(s.id, s);
    return map;
  }, [recentStudents, portfolio]);

  // 1. Task notifications.
  //    `announced` holds the tasks already dealt with. A task that is not addressed to
  //    me is deliberately NOT recorded, so if it is later reassigned to me (the MCP
  //    assign_task tool rewrites recipientIds without touching createdAt) the next
  //    snapshot still announces it.
  const announcedTasksRef = useRef<Set<string>>();
  useEffect(() => {
    if (!tasks || !user || tasksLoading) return;

    const cutOffTime = since(`lastViewedTasks_${user.id}`);
    const firstPass = !announcedTasksRef.current;
    if (!announcedTasksRef.current) announcedTasksRef.current = new Set<string>();
    const announced = announcedTasksRef.current;

    const open = () => router.push('/tasks');
    const announce = (task: Task) => {
      announced.add(task.id);
      playNotificationSound();
      toast({
        title: 'New Task/Update Received',
        description: task.content.substring(0, 50) + '...',
        action: <ToastAction altText="View" onClick={open}>View</ToastAction>,
      });
    };

    const mine: Task[] = [];
    const pending: Task[] = [];
    tasks.forEach(task => {
      if (announced.has(task.id) || task.authorId === user.id || task.createdAt <= cutOffTime) return;

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

      // A department only hears about students in its own countries. The student is
      // usually not in the small loaded set yet (the task is written before the
      // student's activity stamp), so those go through a lookup; a missing student
      // never blocked the toast before and does not now.
      if (user.role === 'department' && task.studentId && !knownStudents.has(task.studentId)) {
        pending.push(task);
        return;
      }
      if (user.role === 'department' && task.studentId) {
        if (isStudentInUserDepartment(knownStudents.get(task.studentId)!, user.department)) mine.push(task);
        else announced.add(task.id);
        return;
      }
      mine.push(task);
    });

    // On the very first snapshot this is the catch-up backlog. One toast each is fine
    // for a handful; beyond that a single summary replaces the pile of beeps.
    if (firstPass && mine.length > 5) {
      mine.forEach(t => announced.add(t.id));
      playNotificationSound();
      toast({
        title: 'New Tasks & Updates',
        description: `${mine.length} items arrived since you last checked.`,
        action: <ToastAction altText="View" onClick={open}>View</ToastAction>,
      });
    } else {
      mine.forEach(announce);
    }

    pending.forEach(task => {
      getDoc(doc(firestore, 'students', task.studentId!))
        .then(snap => {
          if (announced.has(task.id)) return;
          const s = snap.exists() ? (snap.data() as Student) : undefined;
          if (!s || isStudentInUserDepartment(s, user.department)) announce(task);
          else announced.add(task.id);
        })
        .catch(() => { if (!announced.has(task.id)) announce(task); });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, tasksLoading, user, toast, router, knownStudents]);

  // 2. Event notifications
  const prevEventsRef = useRef<Set<string>>();
  useEffect(() => {
    if (!events || !user || eventsLoading) return;

    // Same catch-up rule as tasks: events added since the user last read the feed are
    // announced once, on the first snapshot.
    const cutOffTime = since(`lastViewedEvents_${user.id}`);
    if (!prevEventsRef.current) prevEventsRef.current = new Set<string>();

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  //    For management the backlog query supplies the starting counts, so a student who
  //    already owed me messages is known from the outset and only a genuine increase
  //    announces. Employees keep the old rule that a student seen for the first time
  //    never announces, so a transfer that carries an unread count over says only
  //    "Student Assigned".
  const chatSource = useMemo(() => {
    if (isEmployee) return portfolio;
    const map = new Map<string, Student>();
    for (const s of chatBacklog || []) map.set(s.id, s);
    for (const s of recentStudents || []) map.set(s.id, s); // fresher copy wins
    return Array.from(map.values());
  }, [isEmployee, portfolio, chatBacklog, recentStudents]);
  const chatLoading = isEmployee ? portfolioLoading : (recentLoading || backlogLoading);
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
      if (grew && (wasKnown || !isEmployee)) {
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
