'use client';
import { useState, useEffect, useMemo } from 'react';
import { useUsers } from '@/contexts/users-provider';
import type { User } from '@/lib/types';

// Hook to manage a local cache of user profiles needed by a component
export function useUserCacheById(ids: string[] = []) {
  const { fetchUsersById } = useUsers();
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const uniqueIds = useMemo(() => [...new Set(ids.filter(id => id))], [ids]);

  useEffect(() => {
    let isMounted = true;
    
    const idsToFetch = uniqueIds.filter(id => !userMap.has(id));

    if (idsToFetch.length > 0) {
      setIsLoading(true);
      fetchUsersById(idsToFetch)
        .then(fetchedUsers => {
          if (isMounted) {
            setUserMap(prevMap => {
              const newMap = new Map(prevMap);
              fetchedUsers.forEach(user => newMap.set(user.id, user));
              return newMap;
            });
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) {
            setIsLoading(false);
          }
        });
    }

    // Prune old users from cache that are no longer needed
    if (isMounted) {
      const currentIds = new Set(uniqueIds);
      let mapChanged = false;
      const newMap = new Map(userMap);
      newMap.forEach((_, key) => {
        if (!currentIds.has(key)) {
          newMap.delete(key);
          mapChanged = true;
        }
      });
      if (mapChanged) {
        setUserMap(newMap);
      }
    }

    return () => {
      isMounted = false;
    };
  // The dependency array is critical. It should NOT include userMap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(uniqueIds), fetchUsersById]);
  
  return { userMap, isLoading };
}


export function useUserCacheByCivilId(civilIds: string[] = []) {
  const { fetchUsersByCivilId } = useUsers();
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const uniqueIds = useMemo(() => [...new Set(civilIds.filter(id => id))], [civilIds]);

  useEffect(() => {
    let isMounted = true;
    
    const idsToFetch = uniqueIds.filter(id => !userMap.has(id));

    if (idsToFetch.length > 0) {
      setIsLoading(true);
      fetchUsersByCivilId(idsToFetch)
        .then(fetchedUsers => {
          if (isMounted) {
            setUserMap(prevMap => {
              const newMap = new Map(prevMap);
              fetchedUsers.forEach(user => {
                if (user.civilId) newMap.set(user.civilId, user);
              });
              return newMap;
            });
            setIsLoading(false);
          }
        })
        .catch(() => {
          if (isMounted) {
            setIsLoading(false);
          }
        });
    }

    // Prune old users
    if (isMounted) {
        const currentIds = new Set(uniqueIds);
        let mapChanged = false;
        const newMap = new Map(userMap);
        newMap.forEach((user, key) => {
            if (!currentIds.has(key)) {
                newMap.delete(key);
                mapChanged = true;
            }
        });
        if(mapChanged) {
            setUserMap(newMap);
        }
    }

    return () => {
      isMounted = false;
    };
  // The dependency array is critical. It should NOT include userMap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(uniqueIds), fetchUsersByCivilId]);
  
  return { userMap, isLoading };
}
