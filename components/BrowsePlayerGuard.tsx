'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePersistentPlayer } from './PersistentPlayerProvider';

export default function BrowsePlayerGuard() {
  const pathname = usePathname();
  const { stopPlayer } = usePersistentPlayer();

  useEffect(() => {
    if (pathname !== '/') return;
    const timer = window.setTimeout(() => stopPlayer(), 0);
    return () => window.clearTimeout(timer);
  }, [pathname, stopPlayer]);

  return null;
}
