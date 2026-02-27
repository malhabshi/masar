
'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot, DocumentData, DocumentReference } from 'firebase/firestore';
import { firestore, auth } from '@/firebase';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

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
        const value = data[key];
        converted[key] = convertTimestamps(value);
      }
    }
    return converted as T;
  }
  
  return data as T;
}

/**
 * Unified hook to subscribe to a single Firestore document.
 * Supports both string path segments and Reference objects.
 */
export function useDoc<T>(target: string | DocumentReference | null | undefined, ...pathSegments: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
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
      setIsLoading(false);
      setData(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);

    try {
      let docRef: DocumentReference;
      if (typeof target === 'string') {
        if (pathSegments.some(s => !s)) {
          setIsLoading(false);
          return;
        }
        docRef = doc(firestore, target, ...pathSegments);
      } else {
        docRef = target;
      }

      const unsubscribe = onSnapshot(docRef, 
        (snapshot) => {
          if (isMounted) {
            if (snapshot.exists()) {
              const docData = snapshot.data();
              const converted = convertTimestamps<DocumentData>(docData);
              setData({ id: snapshot.id, ...converted } as T);
            } else {
              setData(null);
            }
            setIsLoading(false);
            setError(null);
          }
        },
        (err) => {
          if (isMounted) {
            console.error(`[useDoc] error:`, err);
            const permissionError = new FirestorePermissionError({
                path: docRef.path,
                operation: 'get'
            });
            errorEmitter.emit('permission-error', permissionError);
            setError(err);
            setIsLoading(false);
          }
        }
      );

      return () => {
        isMounted = false;
        unsubscribe();
      };
    } catch (e: any) {
      console.error(`[useDoc] setup error:`, e);
      setIsLoading(false);
      setError(e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthReady, JSON.stringify(typeof target === 'string' ? [target, ...pathSegments] : null), (target as any)?.__memo]);

  return { data, isLoading, error };
}
