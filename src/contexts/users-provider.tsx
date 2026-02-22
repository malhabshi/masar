'use client';

import { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { User } from '@/lib/types';

interface UsersContextType {
  users: User[];
  usersLoading: boolean;
  usersById: Map<string, User>;
  usersByCivilId: Map<string, User>;
  getUserById: (id: string) => User | undefined;
  getUserByCivilId: (civilId: string | null) => User | undefined;
  error: Error | null;
}

const UsersContext = createContext<UsersContextType | undefined>(undefined);

export function UsersProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const usersCol = collection(firestore, 'users');
        const snapshot = await getDocs(usersCol);
        const usersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as User[];
        setUsers(usersData);
      } catch (err) {
        setError(err as Error);
        console.error("Failed to fetch users:", err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUsers();
  }, []);

  const usersById = useMemo(() => new Map(users.map(user => [user.id, user])), [users]);
  
  const usersByCivilId = useMemo(() => {
    const map = new Map<string, User>();
    users.forEach(user => {
      if (user.civilId) {
        map.set(user.civilId, user);
      }
    });
    return map;
  }, [users]);

  const getUserById = (id: string): User | undefined => usersById.get(id);
  const getUserByCivilId = (civilId: string | null): User | undefined => civilId ? usersByCivilId.get(civilId) : undefined;

  const value: UsersContextType = { 
    users, 
    usersLoading: isLoading, 
    usersById, 
    usersByCivilId,
    getUserById,
    getUserByCivilId,
    error 
  };

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
