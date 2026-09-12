'use client';

import Link from 'next/link';
import { ArrowLeft, Heart, Play, Radio, Share2, Tv2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Channel } from '../lib/source';
import styles from './ChannelProfilePage.module.css';

const FAVORITES_KEY = 'momsat:favorites:v1';

function readFavoriteIds() {
  try {
    const value = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) || '[]');
    return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [] as number[];
  }
}

export default function ChannelProfilePage({ channel, recommendations }: { channel: Channel; recommendations: Channel[] }) {
  const [favorite, setFavorite] = useState(false);
  const [shared, setShared] = useState(false);

  useEffect(() => setFavorite(readFavoriteIds().includes(channel.id)), [channel.id]);

  const toggleFavorite = () => {
    const current = readFavoriteIds();
    const next = current.includes(channel.id)
      ? current.filter((id) => id !== channel.id)
      : [channel.id, ...current].slice(0, 100);
    try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch {}
    setFavorite(next.includes(channel.id));
  };

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: channel.name, text: `${channel.name} — MOMSAT`, url });
      } else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        window.setTimeout(() => setShared(false), 1800);
      }
    } catch {}
  };

  return (
    <main className={styles.page} dir="rtl">
      <div className={styles.topbar}>
        <Link href="/" className={styles.back}><ArrowLeft size={16} /> بازگشت به صفحه اصلی</Link>
        <span className={styles.brand}>MOMSAT</span>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroImage}>
          {channel.image ? <img src={channel.image} alt="" /> : <div className={styles.fallback}>{(channel.nameEn || channel.name).slice(0, 3).toUpperCase()}</div>}
          <div className={styles.scrim} />
        </div>
        <div className={styles.heroContent}>
          <div className={styles.eyebrow}><Radio size={14} /> صفحه شبکه</div>
          <h1>{channel.name}</h1>
          <p>{channel.nameEn || 'Live television'} · {channel.category || 'Live TV'}</p>
          <div className={styles.actions}>
            <Link href={`/watch?v=${channel.id}`} className={styles.primary}><Play size={16} fill="currentColor" /> تماشای زنده</Link>
            <button type="button" className={`${styles.secondary}${favorite ? ` ${styles.favoriteActive}` : ''}`} onClick={toggleFavorite} aria-pressed={favorite}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /> {favorite ? 'ذخیره شد' : 'افزودن به علاقه‌مندی'}</button>
            <button type="button" className={styles.secondary} onClick={share}><Share2 size={16} /> {shared ? 'کپی شد' : 'اشتراک‌گذاری'}</button>
          </div>
        </div>
      </section>

      <section className={styles.stats}>
        <div><strong>{channel.country || 'بین‌المللی'}</strong><span>موقعیت</span></div>
        <div><strong>{channel.category || 'Live TV'}</strong><span>دسته</span></div>
        <div><strong>{channel.sources.length}</strong><span>مسیرهای پخش</span></div>
        <div><strong>{channel.popular.toLocaleString('fa-IR')}</strong><span>محبوبیت</span></div>
      </section>

      <section className={styles.contentGrid}>
        <article className={styles.infoCard}>
          <div className={styles.cardTitle}><Tv2 size={18} /><div><h2>اطلاعات شبکه</h2><p>مشخصات ثبت‌شده برای این کانال</p></div></div>
          <div className={styles.infoGrid}>
            <div><span>نام انگلیسی</span><strong>{channel.nameEn || '—'}</strong></div>
            <div><span>پلتفرم</span><strong>{channel.platform || 'INTERNET'}</strong></div>
            <div><span>ماهواره</span><strong>{channel.satellite || '—'}</strong></div>
            <div><span>فرکانس</span><strong>{channel.frequency || '—'}</strong></div>
            <div><span>Polarization</span><strong>{channel.polarization || '—'}</strong></div>
            <div><span>Symbol Rate</span><strong>{channel.symbolRate || '—'}</strong></div>
          </div>
        </article>

        <aside className={styles.queue}>
          <div className={styles.cardTitle}><Play size={18} /><div><h2>شبکه‌های مرتبط</h2><p>پیشنهادهای نزدیک به این شبکه</p></div></div>
          <div className={styles.relatedList}>
            {recommendations.slice(0, 6).map((item) => (
              <Link key={item.id} href={`/channel/${item.id}`} className={styles.related}>
                <div className={styles.thumb}>{item.image ? <img src={item.image} alt="" loading="lazy" /> : <span>{(item.nameEn || item.name).slice(0, 3).toUpperCase()}</span>}</div>
                <div><strong>{item.name}</strong><span>{item.category || 'Live TV'} · {item.country || 'آنلاین'}</span></div>
              </Link>
            ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
