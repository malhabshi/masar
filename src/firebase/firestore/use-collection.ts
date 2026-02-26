'use client';

import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData, type Query } from 'firebase/firestore';
import { firestore, auth } from '@/firebase';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';
import { useMemoFirebase } from './memo';

/**
 * Recursively convert all Timestamps to Date objects within a data structure.
 */
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

/**
 * Hook to subscribe to a Firestore collection with real-time updates.
 */
export function useCollection<T>(path: string, ...queryConstraints: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Track path changes to reset state
  const lastPathRef = useRef(path);

  // Stable query reference
  const memoizedQuery = useMemoFirebase(() => {
    if (!path) return null;
    try {
        const collectionRef = collection(firestore, path);
        return query(collectionRef, ...queryConstraints);
    } catch(e) {
        console.error(`[useCollection:${path}] Failed to create query:`, e);
        return null;
    }
  }, [path, ...queryConstraints]);

  useEffect(() => {
    // Reset if path changes
    if (path !== lastPathRef.current) {
        setIsLoading(true);
        setData([]);
        lastPathRef.current = path;
    }

    if (!path || !memoizedQuery) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    // Use onAuthStateChanged to ensure the user is ready before listening (rules requirement)
    const unsubscribeAuth = auth.onAuthStateChanged((user) => {
      if (!user) {
        if (isMounted) {
          setData([]);
          setIsLoading(false);
        }
        return;
      }

      // Establish the Firestore listener
      const unsubscribeSnapshot = onSnapshot(memoizedQuery as Query, 
        (snapshot) => {
          if (isMounted) {
            const items = snapshot.docs.map(doc => {
              const docData = doc.data();
              const converted = convertTimestamps<DocumentData>(docData);
              return { id: doc.id, ...converted } as T;
            });
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

      return () => unsubscribeSnapshot();
    });

    return () => {
      isMounted = false;
      unsubscribeAuth();
    };
  }, [memoizedQuery, path]);

  return { data, isLoading, error };
}
