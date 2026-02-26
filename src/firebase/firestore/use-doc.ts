
'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot, DocumentData } from 'firebase/firestore';
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
        const value = data[key];
        converted[key] = convertTimestamps(value);
      }
    }
    return converted as T;
  }
  
  return data as T;
}

export function useDoc<T>(path: string, ...pathSegments: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Track auth readiness to prevent early queries
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);
  
  const memoizedDocRef = useMemoFirebase(() => {
    // Ensure path segments are valid before creating a reference
    if (!path || pathSegments.some(segment => !segment)) {
        return null;
    }
    try {
        return doc(firestore, path, ...pathSegments);
    } catch(e) {
        console.error("Failed to create document reference:", e);
        return null;
    }
  }, [path, ...pathSegments]);


  useEffect(() => {
    // 1. Wait for Firebase Auth to initialize
    if (!isAuthReady) {
      return;
    }

    // 2. Prevent queries if no user is authenticated (since rules require auth for all documents)
    if (!auth.currentUser) {
      setIsLoading(false);
      setData(null);
      return;
    }

    // 3. Prevent queries if no valid doc reference is provided
    if (!memoizedDocRef) {
      setIsLoading(false);
      return;
    }
    
    let isMounted = true;
    setIsLoading(true);
    const unsubscribe = onSnapshot(memoizedDocRef, 
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
            const permissionError = new FirestorePermissionError({
                path: memoizedDocRef.path,
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
  }, [memoizedDocRef, isAuthReady]);

  return { data, isLoading, error };
}
