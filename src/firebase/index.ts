'use client';
import { useMemo } from 'react';

// This is a placeholder file to resolve Firebase-related import errors.
// It provides dummy hooks that return default values.

// Dummy data to be returned by hooks
const placeholderStudent = { 
  id: '1', 
  name: 'Placeholder Student', 
  email: 'student@example.com', 
  phone: '12345',
  employeeId: 'emp1',
  avatarUrl: '',
  applications: [],
  notes: [],
  documents: [],
  createdAt: new Date().toISOString(),
};

export const useFirebase = () => {
    return { firestore: null, auth: null, user: null, isUserLoading: false };
};

export const useDoc = <T,>(ref: any): { data: T | null; isLoading: boolean } => {
    // Return a placeholder student object for the student page to use
    const data = useMemo(() => ({ ...placeholderStudent } as T), []);
    return { data, isLoading: false };
};

export const useCollection = <T,>(ref: any): { data: T[] | null; isLoading: boolean } => {
    return { data: [], isLoading: false };
};
