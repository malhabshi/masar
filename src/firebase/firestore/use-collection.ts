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

  // Track auth readiness to prevent early queries
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const memoizedQuery = useMemoFirebase(() => {
    // 1. Path must be non-empty
    if (!path) return null;

    // 2. SAFETY GUARD: Prevent unfiltered queries on the students collection.
    // This is a fail-safe to prevent permission errors if a component initiates a query before filters are ready.
    const isStudentsPath = path === 'students' || path.endsWith('/students');
    if (isStudentsPath && (!queryConstraints || queryConstraints.length === 0)) {
        // If we get here with 0 constraints on 'students', it's a risky query that would likely fail rules.
        return null; 
    }

    try {
        const collectionRef = collection(firestore, path);
        const constraints = Array.isArray(queryConstraints) ? queryConstraints : [];
        return query(collectionRef, ...constraints);
    } catch(e) {
        console.error("Failed to create query:", e);
        return null;
    }
  }, [path, ...(Array.isArray(queryConstraints) ? queryConstraints : [])]);


  useEffect(() => {
    // 1. Wait for Firebase Auth to initialize
    if (!isAuthReady) return;

    // 2. Prevent queries if no user is authenticated
    if (!auth.currentUser) {
      setIsLoading(false);
      setData([]);
      return;
    }

    // 3. Prevent queries if no valid query is constructed (due to guards or empty path)
    if (!memoizedQuery) {
      setIsLoading(false);
      return;
    }
    
    let isMounted = true;
    setIsLoading(true);
    
    const unsubscribe = onSnapshot(memoizedQuery, 
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
            // Check if this is a permission error
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
  }, [memoizedQuery, path, isAuthReady]);

  return { data, isLoading, error };
}
