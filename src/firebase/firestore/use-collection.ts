'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData } from 'firebase/firestore';
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
 * Simplified to ensure maximum reliability for global sync.
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

    setIsLoading(true);
    console.log(`[useCollection] Subscribing to: ${path}`);

    try {
      const collectionRef = collection(firestore, path);
      const q = query(collectionRef, ...queryConstraints);

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          const items = snapshot.docs.map(doc => {
            const converted = convertTimestamps<DocumentData>(doc.data());
            return { id: doc.id, ...converted } as T;
          });
          
          console.log(`[useCollection:${path}] Update received: ${items.length} items`);
          setData(items);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useCollection:${path}] error:`, err);
          if (err.message.toLowerCase().includes('permissions')) {
            errorEmitter.emit('permission-error', new FirestorePermissionError({
              path: path,
              operation: 'list'
            }));
          }
          setError(err);
          setIsLoading(false);
        }
      );

      return () => {
        console.log(`[useCollection] Unsubscribing from: ${path}`);
        unsubscribe();
      };
    } catch (e: any) {
      console.error(`[useCollection:${path}] setup error:`, e);
      setIsLoading(false);
      setError(e);
    }
  }, [path, JSON.stringify(queryConstraints.map(c => c.type))]);

  return { data, isLoading, error };
}
