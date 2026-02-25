'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, QueryConstraint, DocumentData } from 'firebase/firestore';
import { firestore } from '@/firebase';
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

  const memoizedQuery = useMemoFirebase(() => {
    if (!path) return null;
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
    console.log(`🔍 useCollection starting: ${path || '(empty path)'}`, {
      constraintsCount: queryConstraints?.length || 0,
      timestamp: new Date().toISOString()
    });
    
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
            console.error(`❌ Firestore query denied: ${path}`, err);
            const permissionError = new FirestorePermissionError({
                path: path,
                operation: 'list'
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
  }, [memoizedQuery]);

  return { data, isLoading, error };
}
