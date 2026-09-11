'use client';

import Link from 'next/link';
import type { Channel } from '../lib/source';
import { featuredSpotlightOrder } from '../lib/featured-channels';
import styles from './FeaturedChannelRail.module.css';

type Props = { channels: Channel[] };

function findChannel(channels: Channel[], name: string) {
  const wanted = name.trim().toLowerCase();
  return channels.find((channel) => channel.name.toLowerCase() === wanted || channel.nameEn.toLowerCase() === wanted || channel.name.toLowerCase().includes(wanted) || channel.nameEn.toLowerCase().includes(wanted));
}

export default function FeaturedChannelRail({ channels }: Props) {
  const items = featuredSpotlightOrder.map((name) => ({ name, channel: findChannel(channels, name) }));

  return (
    <section className={styles.section} aria-label="شبکه‌های منتخب">
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>EDITOR'S CHOICE · LIVE FIRST</span>
          <h2>شبکه‌های منتخب</h2>
          <p>منتخب‌های MOMSAT بر اساس کیفیت منبع، سابقه پخش و سرعت شروع استریم اولویت‌بندی می‌شوند.</p>
        </div>
        <span className={styles.count}>{items.filter((item) => item.channel).length} فعال</span>
      </div>

      <div className={styles.rail}>
        {items.map(({ name, channel }) => (
          <article className={`${styles.card}${channel ? '' : ` ${styles.pending}`}`} key={name}>
            <div className={styles.thumb}>
              {channel?.image ? <img src={channel.image} alt={channel.name} loading="lazy" decoding="async" /> : <div className={styles.fallback}>{name.slice(0, 3).toUpperCase()}</div>}
              <span className={channel ? styles.live : styles.pendingBadge}>{channel ? 'LIVE' : 'در انتظار تأیید'}</span>
            </div>
            <div className={styles.body}>
              <h3>{channel?.name || name}</h3>
              <p>{channel?.nameEn || (name === 'Fun Plus' ? 'Fun Plus' : name)}</p>
              {channel ? (
                <Link className={styles.watch} href={`/channel/${channel.id}`}>تماشا</Link>
              ) : (
                <span className={styles.note}>هنوز منبع HLS معتبر و قابل‌پخش تأیید نشده است.</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
