'use client';

import { useMemo } from 'react';
import type { User } from '@/lib/types';
import { useCollection } from '@/firebase/client';

export function useUsers() {
  const { data, isLoading } = useCollection<User>('users');
  const users = data || [];

  const usersById = useMemo(() => {
    return new Map(users.map(user => [user.id, user]));
  }, [users]);
  
  const usersByCivilId = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach(user => {
        if(user.civilId) {
            map.set(user.civilId, user);
        }
    });
    return map;
  }, [users]);

  const getUserById = (id: string): User | undefined => {
    return usersById.get(id);
  }

  const getUserByCivilId = (civilId: string | null): User | undefined => {
    return civilId ? usersByCivilId.get(civilId) : undefined;
  }

  return {
    users,
    usersLoading: isLoading,
    usersById,
    usersByCivilId,
    getUserById,
    getUserByCivilId,
  };
}
