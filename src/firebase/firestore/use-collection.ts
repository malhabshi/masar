'use client';

import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, QueryConstraint } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { toDate } from '@/lib/timestamp-utils';

// Recursively convert all Timestamps to Date objects
function convertTimestamps(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  
  if (obj && typeof obj.toDate === 'function' && !(obj instanceof Date)) {
    return toDate(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => convertTimestamps(item));
  }
  
  if (typeof obj === 'object') {
    const converted: any = {};
    for (const key in obj) {
      if(Object.prototype.hasOwnProperty.call(obj, key)) {
          converted[key] = convertTimestamps(obj[key]);
      }
    }
    return converted;
  }
  
  return obj;
}

export function useCollection<T>(collectionPath: string, ...queryConstraints: QueryConstraint[]) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { firestore } = useFirebase();

  useEffect(() => {
    if (!firestore || !collectionPath) {
      setIsLoading(false);
      return;
    }

    const q = query(collection(firestore, collectionPath), ...queryConstraints);

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        const items = snapshot.docs.map(doc => {
          const docData = doc.data();
          // Convert all timestamps in the document
          const converted = convertTimestamps(docData);
          return { id: doc.id, ...converted } as T;
        });
        setData(items);
        setIsLoading(false);
      },
      (err) => {
        console.error('Error fetching collection:', err);
        setError(err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, collectionPath, JSON.stringify(queryConstraints)]);

  return { data, isLoading, error };
}
