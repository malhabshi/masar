'use client';
import { createContext, useContext } from 'react';
import type { User } from '@/lib/types';

// This is a placeholder context to resolve import errors.
const UsersContext = createContext<{ users: User[]; usersLoading: boolean }>({ users: [], usersLoading: true });

export const UsersProvider = ({ children }: { children: React.ReactNode }) => (
  <UsersContext.Provider value={{ users: [{ id: '1', name: 'Placeholder User', email: 'user@example.com', role: 'admin', civilId: '123456789012', avatarUrl: '' }], usersLoading: false }}>
    {children}
  </UsersContext.Provider>
);

export const useUsers = () => useContext(UsersContext);
