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
 */
export function useCollection<T>(path: string, ...queryConstraints: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  // Create a stable string representation of constraints for the dependency array
  const constraintsSerialized = JSON.stringify(queryConstraints.map(c => c.type || 'constraint'));

  useEffect(() => {
    if (!path) {
      setData([]);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    console.log(`[useCollection] Establishing listener for: ${path}`);

    try {
      const collectionRef = collection(firestore, path);
      const q = query(collectionRef, ...queryConstraints);

      const unsubscribe = onSnapshot(q, 
        (snapshot) => {
          if (!isMounted) return;
          
          try {
            const items = snapshot.docs.map(doc => {
              const docData = doc.data();
              const converted = convertTimestamps<DocumentData>(docData);
              return { id: doc.id, ...converted } as T;
            });
            
            console.log(`[useCollection:${path}] Received ${items.length} items`);
            setData(items);
            setIsLoading(false);
            setError(null);
          } catch (mapError: any) {
            console.error(`[useCollection:${path}] Mapping error:`, mapError);
            setError(mapError);
            setIsLoading(false);
          }
        },
        (err) => {
          if (!isMounted) return;
          
          console.error(`[useCollection:${path}] Firestore snapshot error:`, err);
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
        console.log(`[useCollection] Cleaning up listener for: ${path}`);
        isMounted = false;
        unsubscribe();
      };
    } catch (e: any) {
      console.error(`[useCollection:${path}] Failed to create listener:`, e);
      setIsLoading(false);
      setError(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, constraintsSerialized]);

  return { data, isLoading, error };
}
