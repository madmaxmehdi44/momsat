'use client';

import { useMemo, useState } from 'react';
import { Compass, Heart, Play, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Channel } from '../lib/source';
import { usePersistentPlayer } from './PersistentPlayerProvider';
import styles from './YouTubeBrowseShellV2.module.css';

type Props = { channels: Channel[] };

function titleText(channel: Channel) {
  return `${channel.name} ${channel.nameEn} ${channel.category} ${channel.categoryEn} ${channel.country}`.toLocaleLowerCase();
}

function matches(channel: Channel, category: string) {
  if (category === 'all') return true;
  const value = titleText(channel);
  if (category === 'news') return /news|خبر|khabar/.test(value);
  if (category === 'sport') return /sport|ورزش|football|soccer|bein/.test(value);
  if (category === 'music') return /music|موسیقی|موزیک/.test(value);
  if (category === 'movie') return /movie|film|فیلم|cinema|سینما|series|سریال/.test(value);
  if (category === 'radio') return /radio|رادیو/.test(value);
  if (category === 'persian') return channel.language?.toLocaleLowerCase().startsWith('fa') || /فارسی|persian/.test(value);
  return true;
}

export default function DiscoveryShell({ channels }: Props) {
  const router = useRouter();
  const { play } = usePersistentPlayer();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels
      .filter((channel) => matches(channel, category))
      .filter((channel) => !q || titleText(channel).includes(q))
      .sort((a, b) => b.popular - a.popular || b.sources.length - a.sources.length);
  }, [channels, query, category]);

  const openChannel = (channel: Channel) => {
    play({
      channelId: channel.id,
      channelName: channel.name,
      url: channel.url,
      referer: channel.referer,
      origin: channel.origin,
      image: channel.image,
    });
    router.push(`/?discover=1&playing=${channel.id}`);
  };

  return (
    <div className={styles.shell} dir="rtl">
      <header className={styles.header}>
        <div className={styles.headerSide}>
          <button className={styles.logo} type="button" onClick={() => router.replace('/')}>MOM<span>SAT</span></button>
        </div>
        <div className={styles.search}>
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجوی شبکه برای کشف" aria-label="جستجوی شبکه" />
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroContent}>
            <div className={styles.heroEyebrow}><Compass size={15} /> کشف شبکه‌ها</div>
            <h1>شبکه‌های زنده را کشف کنید</h1>
            <p>فهرست شبکه‌های موجود در پایگاه MOMSAT؛ بدون اجرای جستجوی سنگین منابع عمومی.</p>
          </div>
          <div className={styles.heroVisual}><Compass size={92} /></div>
        </section>

        <section className={styles.rail}>
          <div className={styles.railHeader}>
            <div><h2>دسته‌بندی‌ها</h2><p>برای محدود کردن فهرست شبکه‌ها انتخاب کنید.</p></div>
          </div>
          <div className={styles.railViewport} style={{ overflowX: 'auto', paddingBottom: 8 }}>
            {['all', 'persian', 'news', 'sport', 'music', 'movie', 'radio'].map((id) => {
              const labels: Record<string, string> = { all: 'همه', persian: 'فارسی', news: 'اخبار', sport: 'ورزش', music: 'موسیقی', movie: 'فیلم و سریال', radio: 'رادیو' };
              return <button key={id} type="button" className={`${styles.navItem}${category === id ? ` ${styles.navActive}` : ''}`} onClick={() => setCategory(id)} style={{ minWidth: 120 }}>{labels[id]}</button>;
            })}
          </div>
        </section>

        <section className={styles.rail}>
          <div className={styles.railHeader}>
            <div><h2>{filtered.length.toLocaleString('fa-IR')} شبکه</h2><p>برای تماشا یک شبکه را انتخاب کنید.</p></div>
          </div>
          {filtered.length ? (
            <div className={styles.grid}>
              {filtered.map((channel) => (
                <article key={channel.id} className={styles.card}>
                  <button type="button" className={styles.cardLink} onClick={() => openChannel(channel)} aria-label={`پخش ${channel.name}`}>
                    <div className={styles.thumb}>
                      {channel.image ? <img src={channel.image} alt="" loading="lazy" decoding="async" /> : <div className={styles.fallback}>{(channel.nameEn || channel.name).slice(0, 3).toUpperCase()}</div>}
                      <span className={styles.live}><i /> LIVE</span>
                      <span className={styles.hoverPlay}><Play size={18} fill="currentColor" /></span>
                    </div>
                  </button>
                  <div className={styles.cardInfo}>
                    <span className={styles.favorite}><Heart size={16} /></span>
                    <button type="button" className={styles.cardTitle} onClick={() => openChannel(channel)}>{channel.name}</button>
                    <div className={styles.cardMeta}>{channel.category || 'شبکه تلویزیونی'} · {channel.sources.length} منبع</div>
                    <div className={styles.cardSub}>{channel.country || 'پخش آنلاین'}</div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.heroContent}><h2>شبکه‌ای پیدا نشد</h2><p>فیلتر یا عبارت جستجو را تغییر دهید.</p></div>
          )}
        </section>
      </main>
    </div>
  );
}
