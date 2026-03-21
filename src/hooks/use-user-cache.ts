'use client';
import { useState, useEffect, useMemo } from 'react';
import { useUsers } from '@/contexts/users-provider';
import type { User } from '@/lib/types';

// Hook to manage a local cache of user profiles needed by a component
export function useUserCacheById(ids: string[] = []) {
  const { fetchUsersById } = useUsers();
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Sort the unique IDs to create a stable dependency for the useEffect hook
  const uniqueIds = useMemo(() => [...new Set(ids.filter(id => id))].sort(), [ids]);

  useEffect(() => {
    if (uniqueIds.length === 0) {
      if (userMap.size > 0) {
        setUserMap(new Map());
      }
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    fetchUsersById(uniqueIds)
      .then(fetchedUsers => {
        if (isMounted) {
          setUserMap(fetchedUsers);
        }
      })
      .catch((err) => {
        console.error("useUserCacheById failed:", err);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(uniqueIds), fetchUsersById]);
  
  return { userMap, isLoading };
}

export function useUserCacheByCivilId(civilIds: string[] = []) {
  const { fetchUsersByCivilId } = useUsers();
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  // Sort the unique IDs to create a stable dependency for the useEffect hook
  const uniqueIds = useMemo(() => [...new Set(civilIds.filter(id => id))].sort(), [civilIds]);

  useEffect(() => {
    if (uniqueIds.length === 0) {
        if (userMap.size > 0) {
            setUserMap(new Map());
        }
        return;
    }
    
    let isMounted = true;
    setIsLoading(true);

    fetchUsersByCivilId(uniqueIds)
      .then(fetchedUsers => {
        if (isMounted) {
          setUserMap(fetchedUsers);
        }
      })
      .catch((err) => {
        console.error("useUserCacheByCivilId failed:", err);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(uniqueIds), fetchUsersByCivilId]);
  
  return { userMap, isLoading };
}
