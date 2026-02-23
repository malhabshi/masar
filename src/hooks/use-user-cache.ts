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
    if (uniqueIds.length === 0) {
        if (userMap.size > 0) setUserMap(new Map());
        if (isLoading) setIsLoading(false);
        return;
    }

    const idsToFetch = uniqueIds.filter(id => !userMap.has(id));

    if (idsToFetch.length > 0) {
      setIsLoading(true);
      fetchUsersById(idsToFetch).then(fetchedUsers => {
        setUserMap(prevMap => new Map([...prevMap, ...fetchedUsers]));
        setIsLoading(false);
      }).catch(() => setIsLoading(false));
    }
  }, [uniqueIds, fetchUsersById, userMap, isLoading]);
  
  return { userMap, isLoading };
}


export function useUserCacheByCivilId(civilIds: string[] = []) {
  const { fetchUsersByCivilId } = useUsers();
  const [userMap, setUserMap] = useState<Map<string, User>>(new Map());
  const [isLoading, setIsLoading] = useState(false);

  const uniqueIds = useMemo(() => [...new Set(civilIds.filter(id => id))], [civilIds]);

  useEffect(() => {
    if (uniqueIds.length === 0) {
        if (userMap.size > 0) setUserMap(new Map());
        if(isLoading) setIsLoading(false);
        return;
    }

    const idsToFetch = uniqueIds.filter(id => !userMap.has(id));

    if (idsToFetch.length > 0) {
      setIsLoading(true);
      fetchUsersByCivilId(idsToFetch).then(fetchedUsers => {
        setUserMap(prevMap => new Map([...prevMap, ...fetchedUsers]));
        setIsLoading(false);
      }).catch(() => setIsLoading(false));
    }
  }, [uniqueIds, fetchUsersByCivilId, userMap, isLoading]);
  
  return { userMap, isLoading };
}
