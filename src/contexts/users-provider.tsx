'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { User } from '@/lib/types';
import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection } from 'firebase/firestore';

interface UsersContextType {
  users: User[];
  usersLoading: boolean;
}

const UsersContext = createContext<UsersContextType>({
  users: [],
  usersLoading: true,
});

export function UsersProvider({ children }: { children: React.ReactNode }) {
  const { firestore, user } = useFirebase();

  const usersCollection = useMemoFirebase(() => {
    if (!firestore || !user) return null; // Wait for auth
    return collection(firestore, 'users');
  }, [firestore, user]);

  const { data: usersData, isLoading } = useCollection<User>(usersCollection);

  const users = useMemo(() => usersData || [], [usersData]);

  const contextValue = useMemo(() => ({
    users,
    usersLoading: isLoading,
  }), [users, isLoading]);

  return (
    <UsersContext.Provider value={contextValue}>
      {children}
    </UsersContext.Provider>
  );
}

export function useUsers() {
  const context = useContext(UsersContext);
  if (!context) {
    throw new Error('useUsers must be used within a UsersProvider');
  }
  return context;
}
