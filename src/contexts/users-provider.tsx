'use client';

import React, { createContext, useContext } from 'react';
import { useCollection } from '@/firebase/client';
import type { User } from '@/lib/types';

interface UsersContextType {
  users: User[];
  usersLoading: boolean;
}

const UsersContext = createContext<UsersContextType>({ users: [], usersLoading: true });

export const UsersProvider = ({ children }: { children: React.ReactNode }) => {
  const { data: users, isLoading } = useCollection<User>('users');

  const value = {
    users: users || [],
    usersLoading: isLoading,
  };

  return <UsersContext.Provider value={value}>{children}</UsersContext.Provider>;
};

export const useUsers = () => useContext(UsersContext);
