'use client';

import { useState, useEffect } from 'react';
import {
  doc,
  onSnapshot,
  DocumentData,
  DocumentReference,
  FirestoreError,
  DocumentSnapshot,
} from 'firebase/firestore';
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

function isDocumentReference(obj: any): obj is DocumentReference {
  return obj && typeof obj === 'object' && obj.type === 'document';
}

/**
 * Robust hook to subscribe to a single Firestore document in real-time.
 * Supports string paths (with segments) and DocumentReferences.
 */
export function useDoc<T = any>(
  target: string | DocumentReference<DocumentData> | null | undefined,
  ...pathSegments: string[]
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

  useEffect(() => {
    if (!target) {
      setData(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    let unsubscribe = () => {};

    try {
      let docRef: DocumentReference;

      if (typeof target === 'string') {
        if (pathSegments.some(s => !s)) {
          setIsLoading(false);
          return;
        }
        docRef = doc(firestore, target, ...pathSegments);
      } else if (isDocumentReference(target)) {
        docRef = target;
      } else {
        console.warn('[useDoc] Target is not a string or valid DocumentReference:', target);
        setIsLoading(false);
        return;
      }

      unsubscribe = onSnapshot(
        docRef,
        (snapshot: DocumentSnapshot<DocumentData>) => {
          if (snapshot.exists()) {
            const rawData = snapshot.data();
            const converted = convertTimestamps<DocumentData>(rawData);
            setData({ id: snapshot.id, ...(converted as T) });
          } else {
            setData(null);
          }
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useDoc] subscription error:`, err);
          
          const contextualError = new FirestorePermissionError({
            operation: 'get',
            path: docRef.path,
          });

          setError(contextualError);
          setData(null);
          setIsLoading(false);
          errorEmitter.emit('permission-error', contextualError);
        }
      );
    } catch (e: any) {
      console.error(`[useDoc] setup error:`, e);
      setIsLoading(false);
      setError(e);
    }

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(typeof target === 'string' ? [target, ...pathSegments] : null), (target as any)?.__memo]);

  return { data, isLoading, error };
}