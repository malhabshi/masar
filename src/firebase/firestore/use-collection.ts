
'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData, CollectionReference, Query } from 'firebase/firestore';
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
 * Unified hook to subscribe to a Firestore collection or reference with real-time updates.
 * Supports both string paths and Reference/Query objects.
 */
export function useCollection<T>(target: string | CollectionReference | Query | null | undefined, ...queryConstraints: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!target) {
      setData([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let unsubscribe = () => {};

    try {
      let q: Query | CollectionReference;

      if (typeof target === 'string') {
        const collectionRef = collection(firestore, target);
        q = queryConstraints.length > 0 
          ? query(collectionRef, ...queryConstraints)
          : collectionRef;
      } else {
        q = target;
      }

      unsubscribe = onSnapshot(q, 
        (snapshot) => {
          const items = snapshot.docs.map(doc => {
            const converted = convertTimestamps<DocumentData>(doc.data());
            return { id: doc.id, ...converted } as T;
          });
          setData(items);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useCollection] error:`, err);
          
          let path = 'unknown';
          try {
            // @ts-ignore - reaching into internal for path string if possible
            path = typeof target === 'string' ? target : (target as any).path || (target as any)._query?.path?.canonicalString() || 'unknown';
          } catch(e) {}

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
    } catch (e: any) {
      console.error(`[useCollection] setup error:`, e);
      setIsLoading(false);
      setError(e);
    }

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(target === 'string' ? target : null), queryConstraints.length, (target as any)?.__memo]);

  return { data, isLoading, error };
}
