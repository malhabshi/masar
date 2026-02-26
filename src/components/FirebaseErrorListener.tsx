'use client';

import { useEffect, useState } from 'react';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';
import { useToast } from '@/hooks/use-toast';

export function FirebaseErrorListener() {
  const { toast } = useToast();
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    const handlePermissionError = (error: FirestorePermissionError) => {
      // Only show toast if the error message has changed to avoid spam
      const errorKey = `${error.request.method}:${error.request.path}`;
      if (lastError === errorKey) return;
      
      setLastError(errorKey);
      
      toast({
        variant: 'destructive',
        title: 'Access Denied',
        description: 'You do not have permission to perform this action or view this data.',
      });

      // Log full contextual error for developers/agent debugging
      console.error(error.message);
    };

    errorEmitter.on('permission-error', handlePermissionError);

    return () => {
      errorEmitter.off('permission-error', handlePermissionError);
    };
  }, [toast, lastError]);

  return null;
}
