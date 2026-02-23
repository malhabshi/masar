'use client';

import { useEffect } from 'react';
import { useUser } from './use-user';
import { keepAlive } from '@/lib/actions';

const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds

export function useHeartbeat() {
  const { user } = useUser();

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;
    
    const sendKeepAlive = () => {
      if (user && user.role === 'employee') {
        // We don't await this, it's a fire-and-forget ping
        keepAlive(user.id);
      }
    };

    // If the user is an employee, start the heartbeat
    if (user && user.role === 'employee') {
      // Send an initial ping right away
      sendKeepAlive();
      intervalId = setInterval(sendKeepAlive, HEARTBEAT_INTERVAL);
    }
    
    // Best-effort attempt to send a final ping on tab close
    const handleBeforeUnload = () => {
        if (user && user.role === 'employee') {
            // This is not guaranteed to complete, but it's worth a try.
            // Using navigator.sendBeacon would be more reliable but requires a dedicated API endpoint.
            keepAlive(user.id);
        }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);

    // Cleanup function to stop the heartbeat when the component unmounts
    // or the user changes.
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [user]); // Rerun effect if the user changes
}
