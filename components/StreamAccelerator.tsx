'use client';

import { useEffect } from 'react';

type Props = { urls: string[] };

export default function StreamAccelerator({ urls }: Props) {
  useEffect(() => {
    const origins = Array.from(new Set(urls.map((url) => {
      try { return new URL(url, window.location.href).origin; } catch { return ''; }
    }).filter(Boolean)));

    const links: HTMLLinkElement[] = [];
    for (const origin of origins.slice(0, 4)) {
      const link = document.createElement('link');
      link.rel = 'preconnect';
      link.href = origin;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      links.push(link);
    }

    return () => links.forEach((link) => link.remove());
  }, [urls]);

  return null;
}
