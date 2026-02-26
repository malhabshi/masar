'use client';

import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData, type Query } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

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
  
  useEffect(() => {
    if (!path) {
      setData([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    try {
      const collectionRef = collection(firestore, path);
      const q = query(collectionRef, ...queryConstraints);

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          if (!isMounted) return;
          
          const items = snapshot.docs.map(doc => {
            const docData = doc.data();
            const converted = convertTimestamps<DocumentData>(docData);
            return { id: doc.id, ...converted } as T;
          });
          
          setData(items);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          if (!isMounted) return;
          
          console.error(`[useCollection:${path}] Firestore error:`, err);
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
      );

      return () => {
        isMounted = false;
        unsubscribe();
      };
    } catch (e: any) {
      console.error(`[useCollection:${path}] Failed to create listener:`, e);
      setIsLoading(false);
      setError(e);
    }
  }, [path, JSON.stringify(queryConstraints)]);

  return { data, isLoading, error };
}
