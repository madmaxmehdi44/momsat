'use client';

import { useEffect } from 'react';
import { fallbackChannelThumbnail } from '../lib/fallback-thumbnail';

function recoverImage(image: HTMLImageElement) {
  if (image.dataset.momsatRecovered === '1') return;
  image.dataset.momsatRecovered = '1';

  const card = image.closest('article');
  const title = card?.querySelector<HTMLElement>('[class*="cardTitle"]')?.textContent?.trim();
  const hero = image.closest('[class*="hero"]');
  const heroTitle = hero?.querySelector<HTMLElement>('h1')?.textContent?.trim();
  image.src = fallbackChannelThumbnail(title || heroTitle || 'MOMSAT', 'LIVE TV');
}

export default function HomeVisualHardening() {
  useEffect(() => {
    const onError = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const host = target.closest('[class*="YouTubeBrowseShellV2_"]');
      if (!host) return;
      recoverImage(target);
    };

    window.addEventListener('error', onError, true);
    return () => window.removeEventListener('error', onError, true);
  }, []);

  return null;
}
