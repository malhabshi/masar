import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { firebaseConfig } from './config';
import { useMemo, type DependencyList } from 'react';

// Export hooks and utilities from other firebase files
export * from './provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './auth/use-user';
export * from './non-blocking-updates';


let firebaseApp: FirebaseApp;

// Check if Firebase has already been initialized
if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

export function initializeFirebase() {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const storage = getStorage(app);
    return { firebaseApp: app, auth, firestore, storage };
}

/**
 * A hook to memoize Firebase SDK objects like DocumentReference or Query.
 * This is crucial to prevent re-renders and infinite loops when passing these
 * objects as props or as dependencies to other hooks like `useEffect`,
 * `useCollection`, or `useDoc`.
 *
 * It functions identically to React's `useMemo` but is named for clarity
 * in the context of Firebase.
 *
 * @param factory - The function that creates the Firebase object.
 * @param deps - The dependency array for memoization.
 * @returns The memoized Firebase object.
 */
export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, deps);
}
