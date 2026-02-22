'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { User } from '@/lib/types';
import { useCollection } from '@/firebase/client';

interface UsersContextType {
  users: User[];
  usersLoading: boolean;
  usersById: Map<string, User>;
  usersByCivilId: Map<string, User>;
  getUserById: (id: string) => User | undefined;
  getUserByCivilId: (civilId: string | null) => User | undefined;
}

const UsersContext = createContext<UsersContextType | undefined>(undefined);

export function UsersProvider({ children }: { children: React.ReactNode }) {
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

  const value = {
    users,
    usersLoading: isLoading,
    usersById,
    usersByCivilId,
    getUserById,
    getUserByCivilId,
  };

  return (
    <UsersContext.Provider value={value}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const context = useContext(UsersContext);
  if (context === undefined) {
    throw new Error('useUsers must be used within a UsersProvider');
  }
  return context;
}
