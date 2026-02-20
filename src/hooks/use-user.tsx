'use client';
import { createContext, useContext } from 'react';
import type { User } from '@/lib/types';

// This is a placeholder context to resolve import errors.
// The real implementation should provide actual user data.
const UserContext = createContext<{ user: User | null; isUserLoading: boolean }>({ 
  user: { id: '1', name: 'Placeholder User', email: 'user@example.com', role: 'admin', civilId: '123456789012', avatarUrl: '' }, 
  isUserLoading: false 
});

export const UserProvider = ({ children }: { children: React.ReactNode }) => (
  <UserContext.Provider value={{ user: { id: '1', name: 'Placeholder User', email: 'user@example.com', role: 'admin', civilId: '123456789012', avatarUrl: '' }, isUserLoading: false }}>
    {children}
  </UserContext.Provider>
);

export const useUser = () => useContext(UserContext);
