'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData } from 'firebase/firestore';
import { firestore, auth } from '@/firebase';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { useMemoFirebase } from './memo';

// Recursively convert all Timestamps to Date objects
function convertTimestamps<T>(data: any): T {
  if (!data) return data as T;
  
  if (data && typeof data.toDate === 'function' && !(data instanceof Date)) {
    return data.toDate() as T;
  }
  
  if (Array.isArray(data)) {
    return data.map(item => convertTimestamps(item)) as T;
  }
  
  if (typeof data === 'object' && data !== null) {
    const converted: any = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        converted[key] = convertTimestamps(data[key]);
      }
    }
    return converted as T;
  }
  
  return data as T;
}

export function useCollection<T>(path: string, ...queryConstraints: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    // onAuthStateChanged always fires at least once with the current user state
    const unsubscribe = auth.onAuthStateChanged((user) => {
      console.log(`[useCollection:${path}] Auth state changed. User:`, user?.uid || 'none');
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, [path]);

  const memoizedQuery = useMemoFirebase(() => {
    if (!path) return null;

    try {
        const collectionRef = collection(firestore, path);
        const constraints = Array.isArray(queryConstraints) ? queryConstraints : [];
        return query(collectionRef, ...constraints);
    } catch(e) {
        console.error(`[useCollection:${path}] Failed to create query:`, e);
        return null;
    }
  }, [path, ...(Array.isArray(queryConstraints) ? queryConstraints : [])]);


  useEffect(() => {
    if (!isAuthReady) return;

    if (!auth.currentUser) {
      console.log(`[useCollection:${path}] No user logged in. Clearing data.`);
      setIsLoading(false);
      setData([]);
      return;
    }

    if (!memoizedQuery) {
      console.log(`[useCollection:${path}] No query available.`);
      setIsLoading(false);
      return;
    }
    
    let isMounted = true;
    setIsLoading(true);
    
    console.log(`[useCollection:${path}] Setting up listener...`);
    const unsubscribe = onSnapshot(memoizedQuery, 
      (snapshot) => {
        if (isMounted) {
            const items = snapshot.docs.map(doc => {
                const docData = doc.data();
                const converted = convertTimestamps<DocumentData>(docData);
                return { id: doc.id, ...converted } as T;
            });
            console.log(`[useCollection:${path}] Received ${items.length} items.`);
            setData(items);
            setIsLoading(false);
            setError(null);
        }
      },
      (err) => {
        if (isMounted) {
            console.error(`[useCollection:${path}] Snapshot error:`, err);
            if (err.message.toLowerCase().includes('permissions')) {
                const permissionError = new FirestorePermissionError({
                    path: path,
                    operation: 'list'
                });
                errorEmitter.emit('permission-error', permissionError);
            }
            setError(err);
            setIsLoading(false);
        }
      }
    );

    return () => {
        isMounted = false;
        unsubscribe();
    };
  }, [memoizedQuery, path, isAuthReady, queryConstraints.length]);

  return { data, isLoading, error };
}
