'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User as AuthUser } from 'firebase/auth';
import { auth } from '@/firebase'; // Import from the central file
import { useDoc } from '@/firebase/firestore/use-doc'; // Import the correct hook

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'employee' | 'department';
  avatarUrl?: string;
  phone?: string;
  civilId?: string;
  employeeId?: string;
}

interface UserContextType {
  user: AppUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  auth: AuthUser | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);
  
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        setAuthUser(user);
        setIsAuthLoading(false);
      },
      (error) => {
        setAuthError(error);
        setIsAuthLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // CRITICAL FIX: Use the string-based path for the useDoc hook
  const userDocPath = authUser ? `users` : '';
  const userDocId = authUser ? authUser.uid : '';
  const { data: appUser, isLoading: isFirestoreLoading } = useDoc<AppUser>(userDocPath, userDocId);

  const value = {
    user: appUser,
    isUserLoading: isAuthLoading || (authUser && isFirestoreLoading),
    userError: authError,
    auth: authUser,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
