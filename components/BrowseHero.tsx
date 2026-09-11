'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { Channel } from '../lib/source';
import { featuredSpotlightOrder } from '../lib/featured-channels';
import styles from './BrowseHero.module.css';

type Props = { channels: Channel[] };

function pickHero(channels: Channel[]) {
  for (const name of featuredSpotlightOrder) {
    const wanted = name.toLowerCase();
    const match = channels.find((channel) => channel.name.toLowerCase() === wanted || channel.nameEn.toLowerCase() === wanted);
    if (match && match.sources.length > 0) return match;
  }
  return [...channels].sort((a, b) => b.popular - a.popular || (b.sources?.length ?? 0) - (a.sources?.length ?? 0))[0] ?? null;
}

export default function BrowseHero({ channels }: Props) {
  const hero = pickHero(channels);
  const preload = useMemo(() => channels.filter((channel) => channel.image).slice(0, 6), [channels]);

  if (!hero) return null;

  return (
    <>
      {preload.slice(0, 3).map((channel) => channel.image ? <link key={channel.id} rel="preload" as="image" href={channel.image} /> : null)}
      <section className={styles.hero} aria-label="شبکه‌های منتخب">
        <div className={styles.backdrop} style={hero.image ? { backgroundImage: `url("${hero.image.replace(/"/g, '%22')}")` } : undefined} />
        <div className={styles.content}>
          <div className={styles.kicker}>MOMSAT · شبکه‌های منتخب</div>
          <div className={styles.grid}>
            <div className={styles.copy}>
              <span className={styles.live}><i /> SELECTED NETWORK</span>
              <h2>{hero.name}</h2>
              <p>{hero.nameEn || 'Selected live television'}</p>
              <div className={styles.meta}>
                <span>{hero.category || 'شبکه تلویزیونی'}</span>
                {hero.country ? <span>{hero.country}</span> : null}
                {hero.satellite ? <span>ماهواره‌ای</span> : null}
                <span>{hero.sources?.length ?? 0} منبع فعال</span>
              </div>
              <div className={styles.actions}>
                <Link className={styles.primary} href={`/channel/${hero.id}`}>تماشا</Link>
                <Link className={styles.secondary} href={`/channel/${hero.id}`}>جزئیات شبکه</Link>
              </div>
            </div>
            <div className={styles.visual}>
              {hero.image ? <img src={hero.image} alt={hero.name} fetchPriority="high" decoding="async" /> : <div className={styles.fallback}>{(hero.nameEn || hero.name).slice(0, 3).toUpperCase()}</div>}
              <div className={styles.glow} />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
