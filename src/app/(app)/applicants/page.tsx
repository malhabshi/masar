'use client';

import { useEffect, useState } from 'react';

export default function ApplicantsPage() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null; // Return nothing on the server to ensure no mismatch
  }

  // Render a simple div only on the client
  return <div>Test</div>;
}
