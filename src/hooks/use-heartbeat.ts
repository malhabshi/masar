'use client';

import { useEffect, useState } from 'react';
import { useUser } from './use-user';
import { keepAlive } from '@/lib/actions';

const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds

export function useHeartbeat() {
  const { user } = useUser();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    // Guard against running on server or before mount
    if (!isMounted) {
      return;
    }

    let intervalId: NodeJS.Timeout | null = null;
    
    const sendKeepAlive = () => {
      if (user && user.role === 'employee') {
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
      if (intervalId) {
        clearInterval(intervalId);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user, isMounted]);
}
