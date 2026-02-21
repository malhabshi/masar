'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { useFirebase } from '@/firebase';
import { toDate } from '@/lib/timestamp-utils';


// Recursively convert all Timestamps to Date objects
function convertTimestamps<T>(data: any): T {
  if (!data) return data;
  
  const converted: any = Array.isArray(data) ? [] : {};
  
  for (const key in data) {
    if(Object.prototype.hasOwnProperty.call(data, key)) {
        const value = data[key];
        
        if (value && typeof value.toDate === 'function' && !(value instanceof Date)) {
          converted[key] = toDate(value);
        } else if (value && typeof value === 'object') {
          converted[key] = convertTimestamps(value);
        } else {
          converted[key] = value;
        }
    }
  }
  
  return converted;
}


export function useDoc<T>(path: string, ...pathSegments: string[]) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { firestore } = useFirebase();

  useEffect(() => {
    if (!firestore || !path) {
      setIsLoading(false);
      return;
    }

    const docRef = doc(firestore, path, ...pathSegments);

    const unsubscribe = onSnapshot(docRef, 
      (snapshot) => {
        if (snapshot.exists()) {
          setData(convertTimestamps<T>({ id: snapshot.id, ...snapshot.data() }));
        } else {
          setData(null);
        }
        setIsLoading(false);
      },
      (err) => {
        console.error('Error fetching document:', err);
        setError(err);
        setIsLoading(false);
      }
    );

    return () => unsubscribe();
  }, [firestore, path, JSON.stringify(pathSegments)]);

  return { data, isLoading, error };
}
