'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function NotificationsPage() {
  const router = useRouter();

  useEffect(() => {
    // This page is removed. Redirecting to dashboard.
    router.replace('/dashboard');
  }, [router]);

  return null;
}
