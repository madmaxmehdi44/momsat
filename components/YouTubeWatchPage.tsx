'use client';

import Link from 'next/link';
import { Check, Copy, Heart, MoreHorizontal, Share2, Tv2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Channel } from '../lib/source';
import SmartPlayer from './SmartPlayer';
import styles from './YouTubeWatchPage.module.css';

type Props = { channel: Channel; recommendations: Channel[] };
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';
function readIds(key: string) { try { const value = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []; } catch { return []; } }
function writeIds(key: string, ids: number[]) { try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch {} }
export default function YouTubeWatchPage({ channel, recommendations }: Props) {
  const [favorite, setFavorite] = useState(false);
  const [theater, setTheater] = useState(false);
  const [shared, setShared] = useState(false);
  const [showMore, setShowMore] = useState(false);
  useEffect(() => { setFavorite(readIds(FAVORITES_KEY).includes(channel.id)); writeIds(RECENT_KEY, [channel.id, ...readIds(RECENT_KEY).filter((id) => id !== channel.id)].slice(0, 30)); }, [channel.id]);
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.target instanceof HTMLInput || event.target instanceof HTMLTextAreaElement) return; if (event.key.toLowerCase() === 't') setTheater((v) => !v); if (event.key === 'Escape') setTheater(false); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  const toggleFavorite = () => { const current = readIds(FAVORITES_KEY); const next = current.includes(channel.id) ? current.filter((id) => id !== channel.id) : [channel.id, ...current].slice(0, 100); writeIds(FAVORITES_KEY, next); setFavorite(next.includes(channel.id)); };
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); setShared(true); window.setTimeout(() => setShared(false), 1800); } catch {} };
  const share = async () => { const url = window.location.href; try { if (navigator.share) await navigator.share({ title: channel.name, text: `${channel.name} — MOMSAT`, url }); else await copyLink(); } catch {} };
  return <div className={styles.page}>
    <main className={`${styles.layout}${theater ? ` ${styles.theater}` : ''}`}>
      <section className={styles.mainColumn}>
        <div className={styles.watchToolbar}><Link href="/browse" className={styles.back}>← بازگشت به شبکه‌ها</Link><button className={styles.headerButton} type="button" onClick={() => setTheater((v) => !v)}>{theater ? <X size={15} /> : <Tv2 size={15} />}{theater ? 'خروج از حالت سینما' : 'حالت سینما'}</button></div>
        <div className={styles.playerShell}><SmartPlayer channel={channel} /></div>
        <div className={styles.channelHeader}><div className={styles.titleBlock}><div className={styles.liveLine}><span /> پخش زنده · {channel.category || 'تلویزیون'}</div><h1>{channel.name}</h1><p>{channel.nameEn || 'Live television'} · {channel.sources.length} مسیر ثبت‌شده</p></div><div className={styles.actions}><button type="button" onClick={toggleFavorite} className={favorite ? styles.activeAction : undefined} aria-pressed={favorite}><Heart size={17} fill={favorite ? 'currentColor' : 'none'} /> {favorite ? 'ذخیره شد' : 'علاقه‌مندی'}</button><button type="button" onClick={share}><Share2 size={17} /> {shared ? 'کپی شد' : 'اشتراک‌گذاری'}</button><button type="button" aria-label="بیشتر" aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}><MoreHorizontal size={18} /></button></div></div>
        {showMore && <div className={styles.moreMenu}><button type="button" onClick={copyLink}>{shared ? <Check size={15} /> : <Copy size={15} />} {shared ? 'لینک کپی شد' : 'کپی لینک صفحه'}</button><span>حالت سینما: T</span></div>}
        <div className={styles.infoStrip}><div><strong>{channel.country || 'بین‌المللی'}</strong><span>موقعیت پخش</span></div><div><strong>{channel.platform || 'INTERNET'}</strong><span>پلتفرم</span></div><div><strong>{channel.sources.length}</strong><span>مسیر ثبت‌شده</span></div><div><strong>{channel.popular.toLocaleString('fa-IR')}</strong><span>امتیاز محبوبیت</span></div></div>
        <details className={styles.details}><summary>اطلاعات شبکه و مسیرهای پخش</summary><div className={styles.detailGrid}><div><p><b>دسته:</b> {channel.category || '—'} / {channel.categoryEn || '—'}</p><p><b>ماهواره:</b> {channel.satellite || '—'}</p><p><b>فرکانس:</b> {channel.frequency || '—'}</p><p><b>Polarization:</b> {channel.polarization || '—'}</p><p><b>Symbol Rate:</b> {channel.symbolRate || '—'}</p></div><div>{channel.sources.map((source,index)=><div className={styles.source} key={source.id ?? source.url}><strong>مسیر {index + 1}</strong><span>{source.title || 'Live source'}</span></div>)}</div></div></details>
      </section>
      <aside className={styles.sidebar}><div className={styles.sideTitle}><div><h2>بعدی برای تماشا</h2><p>پیشنهادهای مرتبط با همین دسته و محبوبیت کاتالوگ</p></div><span className={styles.queueCount}>{recommendations.length}</span></div><div className={styles.upNextList}>{recommendations.map((item,index)=><Link key={item.id} href={`/channel/${item.id}`} className={styles.recommendation}><div className={styles.recThumb}>{item.image?<img src={item.image} alt={item.name} loading="lazy"/>:<span>{(item.nameEn||item.name).slice(0,3).toUpperCase()}</span>}<b>تماشا</b><em>{index+1}</em></div><div className={styles.recText}><strong>{item.name}</strong><span>{item.category||'Live TV'} · {item.sources.length} مسیر</span><small>{item.country||'پخش آنلاین'}</small></div></Link>)}</div></aside>
    </main>
  </div>;
}
