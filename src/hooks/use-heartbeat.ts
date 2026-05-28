'use client';

import { useEffect, useRef, useState } from 'react';
import { useUser } from './use-user';
import { keepAlive } from '@/lib/actions';

const HEARTBEAT_INTERVAL = 60 * 1000;  // send keepAlive every 60 s when active
const IDLE_TIMEOUT      = 15 * 60 * 1000; // 15 minutes of no input = idle

export function useHeartbeat() {
  const { user } = useUser();
  const [isMounted, setIsMounted] = useState(false);
  const lastActivityRef = useRef<number>(Date.now());
  const wasIdleRef      = useRef<boolean>(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted || !user || user.role !== 'employee') return;

    const send = () => keepAlive(user.id);

    // Called on any user interaction
    const onActivity = () => {
      const wasIdle = wasIdleRef.current;
      lastActivityRef.current = Date.now();
      wasIdleRef.current = false;
      // Immediately resume the session when returning from idle
      if (wasIdle) send();
    };

    // Periodic tick — skipped entirely when user is idle
    const tick = () => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs > IDLE_TIMEOUT) {
        wasIdleRef.current = true;
        return; // don't update lastSeen while idle
      }
      send();
    };

    const events = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    events.forEach(e => window.addEventListener(e, onActivity, { passive: true }));

    // Fire immediately so the session is marked active on mount
    send();
    const intervalId = setInterval(tick, HEARTBEAT_INTERVAL);

    const handleBeforeUnload = () => send();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(intervalId);
      events.forEach(e => window.removeEventListener(e, onActivity));
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, isMounted]);
}
