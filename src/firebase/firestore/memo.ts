'use client';

import { useMemo } from 'react';

// A helper to memoize Firebase queries and references.
// This prevents infinite loops in useEffect hooks that depend on these objects.
// The stringified dependencies are a simple way to check for changes.
export const useMemoFirebase = <T>(factory: () => T, deps: any[]): T => {
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(factory, [JSON.stringify(deps)]);
};
