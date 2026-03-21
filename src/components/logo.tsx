'use client';

import { GraduationCap } from 'lucide-react';
import { useEffect, useState } from 'react';

export function Logo() {
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true); 
  }, []);

  useEffect(() => {
    if (!isMounted) return;

    try {
        const savedLogo = localStorage.getItem('customLogo');
        if (savedLogo) {
            setLogoSrc(savedLogo);
        }
    } catch(error){
        console.error("Could not read logo from local storage", error);
    }

    const handleLogoUpdate = (event: Event) => {
        setLogoSrc((event as CustomEvent).detail);
    };

    window.addEventListener('logo-updated', handleLogoUpdate);

    return () => {
        window.removeEventListener('logo-updated', handleLogoUpdate);
    };
  }, [isMounted]);

  if (!isMounted) {
      // Return a placeholder on the server to avoid hydration mismatch
      return (
        <div className="flex items-center gap-2 text-lg font-bold text-sidebar-foreground">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground p-2 rounded-lg flex items-center justify-center h-10 w-10">
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="hidden group-data-[collapsible=icon]:hidden">Masar</span>
        </div>
      )
  }

  return (
    <div className="flex items-center gap-2 text-lg font-bold text-sidebar-foreground">
      <div className="bg-sidebar-primary text-sidebar-primary-foreground p-2 rounded-lg flex items-center justify-center h-10 w-10">
        {logoSrc ? (
            <img src={logoSrc} alt="Custom Logo" className="h-6 w-6 object-contain" />
        ) : (
            <GraduationCap className="h-6 w-6" />
        )}
      </div>
      <span className="hidden group-data-[collapsible=icon]:hidden">Masar</span>
    </div>
  );
}
