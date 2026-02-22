'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { useCollection, firestore, useMemoFirebase } from '@/firebase';
import type { User } from '@/lib/types';
import { collection } from 'firebase/firestore';

interface UsersContextType {
  users: User[];
  usersLoading: boolean;
}

const UsersContext = createContext<UsersContextType>({ users: [], usersLoading: true });

export const UsersProvider = ({ children }: { children: React.ReactNode }) => {
  const usersCollection = useMemoFirebase(() => collection(firestore, 'users'), []);
  const { data: users, isLoading } = useCollection<User>(usersCollection);

  const value = {
    users: users || [],
    usersLoading: isLoading,
  };

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>;
};

export const useUsers = () => useContext(UsersContext);
