'use client';

import { useMemo, type DependencyList } from 'react';

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
