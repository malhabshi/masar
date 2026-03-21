'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as AuthUser } from 'firebase/auth';
import { auth, firestore } from '@/firebase'; 
import { useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'employee' | 'department';
  avatarUrl?: string;
  phone?: string;
  civilId?: string;
  employeeId?: string;
  department?: string;
}

export type ViewMode = 'management' | 'employee';

interface UserContextType {
  user: AppUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  auth: AuthUser | null;
  viewMode: ViewMode;
  toggleViewMode: () => void;
  effectiveRole: 'admin' | 'employee' | 'department';
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('management');
  
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(
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

  // Sync viewMode from localStorage on mount
  useEffect(() => {
    const savedMode = localStorage.getItem('appViewMode') as ViewMode;
    if (savedMode === 'employee' || savedMode === 'management') {
      setViewMode(savedMode);
    }
  }, []);

  const userDocRef = useMemoFirebase(() => {
    if (!authUser) return null;
    return doc(firestore, 'users', authUser.uid);
  }, [authUser]);

  const { data: appUser, isLoading: isFirestoreLoading } = useDoc<AppUser>(userDocRef);
  
  const toggleViewMode = () => {
    const newMode = viewMode === 'management' ? 'employee' : 'management';
    setViewMode(newMode);
    localStorage.setItem('appViewMode', newMode);
  };

  // Determine the role to use for UI rendering
  const effectiveRole = React.useMemo((): 'admin' | 'employee' | 'department' => {
    if (!appUser) return 'employee'; // Fallback
    if (appUser.role === 'employee') return 'employee';
    return viewMode === 'employee' ? 'employee' : appUser.role;
  }, [appUser, viewMode]);

  const value: UserContextType = {
    user: appUser,
    isUserLoading: isAuthLoading || (!!authUser && isFirestoreLoading),
    userError: authError,
    auth: authUser,
    viewMode,
    toggleViewMode,
    effectiveRole,
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
