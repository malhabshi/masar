
'use client';

import React, { createContext, useContext, useMemo } from 'react';
import type { User, UserRole } from '@/lib/types';
import { useFirebase, useDoc } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';

interface UserContextType {
  user: User | null;
  updateUserRole: (userId: string, newRole: UserRole, oldRole?: UserRole) => Promise<void>;
  isUserLoading: boolean; 
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { firestore, user: authUser, isUserLoading: isAuthLoading } = useFirebase();

  const userDocRef = useMemo(() => {
    if (!firestore || !authUser) return null;
    return doc(firestore, 'users', authUser.uid);
  }, [firestore, authUser]);

  const { data: currentUserData, isLoading: isProfileLoading } = useDoc<User>(userDocRef);

  const updateUserRole = async (userId: string, newRole: UserRole, oldRole?: UserRole) => {
    if(!firestore) return;
    const userDocToUpdateRef = doc(firestore, 'users', userId);
    // This is now the single source of truth for a user's role.
    await updateDoc(userDocToUpdateRef, { role: newRole });
  };
  
  const contextValue = useMemo(() => ({
    user: currentUserData,
    updateUserRole,
    isUserLoading: isAuthLoading || isProfileLoading,
  }), [currentUserData, isAuthLoading, isProfileLoading]);

  return (
    <UserContext.Provider value={contextValue}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}
    