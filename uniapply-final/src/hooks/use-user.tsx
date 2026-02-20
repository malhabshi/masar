'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useFirebase, useDoc } from '@/firebase';
import { doc } from 'firebase/firestore';
import type { User as AppUser } from '@/lib/types'; // Assuming this is your custom user type
import type { User as AuthUser } from 'firebase/auth'; // Firebase Auth User

interface UserContextType {
  user: AppUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  auth: AuthUser | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const { user: authUser, isUserLoading: isAuthLoading, userError: authError } = useFirebase();
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [isAppUserLoading, setAppUserLoading] = useState(true);
  const { firestore } = useFirebase();
  
  const userDocRef = authUser ? doc(firestore, 'users', authUser.uid) : null;
  const { data: firestoreUser, isLoading: isFirestoreLoading } = useDoc<AppUser>(userDocRef);

  useEffect(() => {
    setAppUserLoading(isAuthLoading || isFirestoreLoading);

    if (!isAuthLoading && !isFirestoreLoading) {
      if (firestoreUser) {
        setAppUser(firestoreUser);
      } else {
        setAppUser(null);
      }
    }
  }, [isAuthLoading, isFirestoreLoading, firestoreUser]);

  const value = {
    user: appUser,
    isUserLoading: isAppUserLoading,
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
