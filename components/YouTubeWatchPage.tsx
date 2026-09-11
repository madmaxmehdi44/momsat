'use client';

import Link from 'next/link';
import { Heart, MoreHorizontal, Share2 } from 'lucide-react';
import type { Channel } from '../lib/source';
import SmartPlayer from './SmartPlayer';
import styles from './YouTubeWatchPage.module.css';

type Props = { channel: Channel; recommendations: Channel[] };
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';

function readIds(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}
function writeIds(key: string, ids: number[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore storage failures */ }
}

export default function YouTubeWatchPage({ channel, recommendations }: Props) {
  const addRecent = () => {
    try {
      const next = [channel.id, ...readIds(RECENT_KEY).filter((id) => id !== channel.id)].slice(0, 30);
      writeIds(RECENT_KEY, next);
    } catch { /* client storage may be unavailable */ }
  };
  const toggleFavorite = () => {
    const current = readIds(FAVORITES_KEY);
    writeIds(FAVORITES_KEY, current.includes(channel.id) ? current.filter((id) => id !== channel.id) : [channel.id, ...current].slice(0, 100));
  };

  return (
    <div className={styles.page} onClickCapture={(event) => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-watch-link]')) addRecent();
    }}>
      <header className={styles.header}>
        <Link href="/browse" className={styles.brand}>MOM<span>SAT</span></Link>
        <Link href="/browse" className={styles.back}>بازگشت به شبکه‌ها</Link>
      </header>

      <main className={styles.layout}>
        <section className={styles.mainColumn}>
          <div className={styles.playerShell}><SmartPlayer channel={channel} /></div>
          <div className={styles.channelHeader}>
            <div className={styles.titleBlock}>
              <div className={styles.liveLine}><span /> LIVE NOW · {channel.category || 'LIVE TV'}</div>
              <h1>{channel.name}</h1>
              <p>{channel.nameEn || 'Live television'} · {channel.sources.length} source{channel.sources.length === 1 ? '' : 's'}</p>
            </div>
            <div className={styles.actions}>
              <button type="button" onClick={toggleFavorite}><Heart size={17} /> علاقه‌مندی</button>
              <button type="button"><Share2 size={17} /> اشتراک‌گذاری</button>
              <button type="button" aria-label="بیشتر"><MoreHorizontal size={18} /></button>
            </div>
          </div>

          <div className={styles.infoStrip}>
            <div><strong>{channel.country || 'بین‌المللی'}</strong><span>موقعیت پخش</span></div>
            <div><strong>{channel.platform || 'INTERNET'}</strong><span>پلتفرم</span></div>
            <div><strong>{channel.sources.length}</strong><span>مسیر فعال</span></div>
            <div><strong>{channel.popular.toLocaleString('fa-IR')}</strong><span>امتیاز محبوبیت</span></div>
          </div>

          <details className={styles.details}>
            <summary>اطلاعات شبکه و مسیرهای پخش</summary>
            <div className={styles.detailGrid}>
              <div>
                <p><b>دسته:</b> {channel.category || '—'} / {channel.categoryEn || '—'}</p>
                <p><b>ماهواره:</b> {channel.satellite || '—'}</p>
                <p><b>فرکانس:</b> {channel.frequency || '—'}</p>
                <p><b>Polarization:</b> {channel.polarization || '—'}</p>
                <p><b>Symbol Rate:</b> {channel.symbolRate || '—'}</p>
              </div>
              <div>
                {channel.sources.map((source, index) => <div className={styles.source} key={source.id ?? source.url}><strong>Source {index + 1}</strong><span>{source.title || 'Live source'}</span></div>)}
              </div>
            </div>
          </details>
        </section>

        <aside className={styles.sidebar}>
          <div className={styles.sideTitle}><div><h2>بعدی برای تماشا</h2><p>شبکه‌های مرتبط با همین کانال</p></div></div>
          <div className={styles.upNextList}>
            {recommendations.map((item) => <Link data-watch-link key={item.id} href={`/channel/${item.id}`} className={styles.recommendation}>
              <div className={styles.recThumb}>
                {item.image ? <img src={item.image} alt="" loading="lazy" /> : <span>{(item.nameEn || item.name).slice(0, 3).toUpperCase()}</span>}
                <b>LIVE</b>
              </div>
              <div className={styles.recText}><strong>{item.name}</strong><span>{item.category || 'Live TV'} · {item.sources.length} منبع</span><small>{item.country || 'پخش آنلاین'}</small></div>
            </Link>)}
          </div>
        </aside>
      </main>
    </div>
  );
}
