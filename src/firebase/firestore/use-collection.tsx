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
import { firestore } from '@/firebase';
import { errorEmitter } from '../error-emitter';
import { FirestorePermissionError } from '../errors';

function isValidQueryOrRef(obj: any): obj is CollectionReference | Query {
  return obj && typeof obj === 'object' && (obj.type === 'collection' || obj.type === 'query');
}

/**
 * Robust hook to subscribe to a Firestore collection or query in real-time.
 * Supports string paths, CollectionReferences, and Queries.
 */
export function useCollection<T = any>(
  target: string | CollectionReference<DocumentData> | Query<DocumentData> | null | undefined,
  ...constraints: QueryConstraint[]
) {
  const [data, setData] = useState<T[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<FirestoreError | Error | null>(null);

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
        q = constraints.length > 0 ? query(collectionRef, ...constraints) : collectionRef;
      } else if (isValidQueryOrRef(target)) {
        q = target;
      } else {
        console.warn('[useCollection] Target is not a string or valid Firestore Reference/Query:', target);
        setIsLoading(false);
        return;
      }

      unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          const items = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as T),
          }));
          setData(items);
          setIsLoading(false);
          setError(null);
        },
        (err) => {
          console.error(`[useCollection] subscription error:`, err);
          
          let path = 'unknown';
          try {
            if (typeof target === 'string') path = target;
            else if ((target as any).path) path = (target as any).path;
            else {
              // Safely attempt to get the query path if it's a query object
              const internalQuery = (target as any)._query || (target as any).query;
              if (internalQuery?.path?.canonicalString) {
                path = internalQuery.path.canonicalString();
              }
            }
          } catch (e) {}

          const contextualError = new FirestorePermissionError({
            operation: 'list',
            path: path,
          });

          setError(contextualError);
          setData(null);
          setIsLoading(false);
          errorEmitter.emit('permission-error', contextualError);
        }
      );
    } catch (e: any) {
      console.error(`[useCollection] setup error:`, e);
      setIsLoading(false);
      setError(e);
    }

    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(typeof target === 'string' ? target : null), constraints.length, (target as any)?.__memo]);

  return { data, isLoading, error };
}