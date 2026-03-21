'use client';

import { createContext, useContext, useCallback, ReactNode } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { User } from '@/lib/types';

interface UsersContextType {
  fetchUsersById: (ids: string[]) => Promise<Map<string, User>>;
  fetchUsersByCivilId: (civilIds: string[]) => Promise<Map<string, User>>;
}

const UsersContext = createContext<UsersContextType | undefined>(undefined);

export function UsersProvider({ children }: { children: ReactNode }) {
  
  const fetchUsersById = useCallback(async (ids: string[]): Promise<Map<string, User>> => {
      const usersMap = new Map<string, User>();
      if (!ids || ids.length === 0) return usersMap;
      
      const uniqueIds = [...new Set(ids.filter(id => id))];
      if (uniqueIds.length === 0) return usersMap;

      // Firestore 'in' query limit is 30. We'll chunk the requests.
      const chunks: string[][] = [];
      for (let i = 0; i < uniqueIds.length; i += 30) {
          chunks.push(uniqueIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const q = query(collection(firestore, 'users'), where('__name__', 'in', chunk));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            usersMap.set(doc.id, { id: doc.id, ...doc.data() } as User);
        });
      }
      return usersMap;
  }, []);

  const fetchUsersByCivilId = useCallback(async (civilIds: string[]): Promise<Map<string, User>> => {
      const usersMap = new Map<string, User>();
      if (!civilIds || civilIds.length === 0) return usersMap;
      
      const uniqueIds = [...new Set(civilIds.filter(id => id))];
      if (uniqueIds.length === 0) return usersMap;

      const chunks: string[][] = [];
      for (let i = 0; i < uniqueIds.length; i += 30) {
          chunks.push(uniqueIds.slice(i, i + 30));
      }

      for (const chunk of chunks) {
        const q = query(collection(firestore, 'users'), where('civilId', 'in', chunk));
        const snapshot = await getDocs(q);
        snapshot.forEach(doc => {
            const user = { id: doc.id, ...doc.data() } as User;
            if (user.civilId) {
               usersMap.set(user.civilId, user);
            }
        });
      }
      return usersMap;
  }, []);

  const value = { fetchUsersById, fetchUsersByCivilId };

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
