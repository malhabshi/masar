
'use client';

import { useState, useEffect } from 'react';
import {
  collection,
  onSnapshot,
  query,
  QueryConstraint,
  DocumentData,
  CollectionReference,
  Query,
  FirestoreError,
} from 'firebase/firestore';
import { firestore, auth } from '../init';
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

function isValidQueryOrRef(obj: any): obj is CollectionReference | Query {
  return obj && typeof obj === 'object' && (obj.type === 'collection' || obj.type === 'query');
}

function getPathFromTarget(target: any): string {
  if (typeof target === 'string') return target;
  if (!target) return 'unknown';
  
  // Try to get path from CollectionReference or Query
  if (target.path) return target.path;
  
  // Try to get path from internal Query structure if available
  try {
    if (target._query && target._query.path) {
      return target._query.path.segments.join('/');
    }
  } catch (e) {}
  
  return 'unknown';
}

/**
 * Unified hook to subscribe to a Firestore collection or query in real-time.
 */
export function useCollection<T = any>(
  target: string | CollectionReference<DocumentData> | Query<DocumentData> | null | undefined,
  ...constraints: QueryConstraint[]
) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isAuthReady) return;
    
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
        q = constraints.length > 0 ? query(collectionRef, ...constraints) : collectionRef;
      } else if (isValidQueryOrRef(target)) {
        q = target;
      } else {
        setIsLoading(false);
        return;
      }

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const items = snapshot.docs.map((doc) => {
            const converted = convertTimestamps<DocumentData>(doc.data());
            return {
              id: doc.id,
              ...(converted as any),
            } as T;
          });
          setData(items);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useCollection] subscription error:`, err);
          
          if (err.code === 'permission-denied') {
            const contextualError = new FirestorePermissionError({
              operation: 'list',
              path: getPathFromTarget(target),
            });
            setError(contextualError);
            errorEmitter.emit('permission-error', contextualError);
          } else {
            setError(err);
          }
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
  }, [isAuthReady, target, constraints.length]);

  return { data, isLoading, error };
}
