'use client';

import { useEffect, useState } from 'react';
import { useUser } from './use-user';
import { keepAlive } from '@/lib/actions';

const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds

/**
 * Hook to maintain a lightweight "active" session for employees.
 * Updates the user's lastSeen timestamp every minute.
 * Heavy background tasks (like inactivity scans) are decoupled from this hook.
 */
export function useHeartbeat() {
  const { user } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    let intervalId: NodeJS.Timeout | null = null;
    
    const sendKeepAlive = () => {
      if (user && user.role === 'employee') {
        // Lightweight call: only updates the user's specific time_log document
        keepAlive(user.id);
      }
    };

    if (user && user.role === 'employee') {
      sendKeepAlive();
      intervalId = setInterval(sendKeepAlive, HEARTBEAT_INTERVAL);
    }
    
    const handleBeforeUnload = () => {
        if (user && user.role === 'employee') {
            keepAlive(user.id);
        }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      if (intervalId) clearInterval(intervalId);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, isMounted]);
}
