'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { usePersistentPlayer } from './PersistentPlayerProvider';

export default function BrowsePlayerGuard() {
  const pathname = usePathname();
  const { stopPlayer } = usePersistentPlayer();

  useEffect(() => {
    if (pathname === '/browse' || pathname === '/') {
      stopPlayer();
    }
  }, [pathname, stopPlayer]);

  return null;
}
