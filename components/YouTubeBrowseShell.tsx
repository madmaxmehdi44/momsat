'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Bell, Clock3, Compass, Heart, Home, Menu, Play, Radio, Search, Settings, Tv, UserCircle } from 'lucide-react';
import type { Channel } from '../lib/source';
import { featuredSpotlightOrder } from '../lib/featured-channels';
import styles from './YouTubeBrowseShell.module.css';

type Props = { channels: Channel[]; initialQuery?: string; initialCategory?: string; initialLibraryMode?: 'all' | 'favorites' | 'recent' };
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';

function readIds(key: string) {
  if (typeof window === 'undefined') return [] as number[];
  try { const value = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []; } catch { return []; }
}
function writeIds(key: string, ids: number[]) { try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ } }
function findFeatured(channels: Channel[]) {
  for (const preferred of featuredSpotlightOrder) {
    const wanted = preferred.toLocaleLowerCase();
    const match = channels.find((channel) => channel.name.toLocaleLowerCase() === wanted || channel.nameEn.toLocaleLowerCase() === wanted);
    if (match) return match;
  }
  return [...channels].sort((a, b) => b.popular - a.popular || b.sources.length - a.sources.length)[0] ?? null;
}
function matchesCategory(channel: Channel, category: string) {
  if (category === 'all') return true;
  const value = `${channel.category} ${channel.categoryEn} ${channel.name} ${channel.nameEn}`.toLocaleLowerCase();
  if (category === 'news') return /news|خبر|khabar/.test(value);
  if (category === 'sport') return /sport|ورزش|football|soccer/.test(value);
  if (category === 'music') return /music|موسیقی|موزیک/.test(value);
  if (category === 'movie') return /movie|film|فیلم|cinema|سینما/.test(value);
  if (category === 'radio') return /radio|رادیو/.test(value);
  if (category === 'persian') return channel.language?.toLocaleLowerCase().startsWith('fa') || /فارسی|persian/.test(value);
  return true;
}
function ChannelCard({ channel, onRecent, favorite, onFavorite }: { channel: Channel; onRecent: (id: number) => void; favorite: boolean; onFavorite: (id: number) => void }) {
  return <article className={styles.card}>
    <Link className={styles.thumbLink} href={`/channel/${channel.id}`} onClick={() => onRecent(channel.id)} aria-label={`تماشای ${channel.name}`}>
      <div className={styles.thumb}>{channel.image ? <img src={channel.image} alt="" loading="lazy" decoding="async" /> : <div className={styles.fallback}>{(channel.nameEn || channel.name).slice(0, 3).toUpperCase()}</div>}<span className={styles.liveBadge}><i />LIVE</span>{channel.vip ? <span className={styles.vipBadge}>VIP</span> : null}<span className={styles.playOverlay}><Play fill="currentColor" size={20} /></span></div>
    </Link>
    <div className={styles.cardBody}>
      <Link className={styles.cardTitle} href={`/channel/${channel.id}`} onClick={() => onRecent(channel.id)}>{channel.name}</Link>
      <div className={styles.cardMeta}>{channel.category || 'شبکه تلویزیونی'} · {channel.sources.length} منبع</div>
      <div className={styles.cardSubmeta}>{channel.country || 'پخش آنلاین'}{channel.satellite ? ` · ${channel.satellite}` : ''}</div>
      <button className={`${styles.favoriteButton}${favorite ? ` ${styles.favoriteActive}` : ''}`} onClick={() => onFavorite(channel.id)} aria-label={favorite ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
    </div>
  </article>;
}

export default function YouTubeBrowseShell({ channels, initialQuery = '', initialCategory = 'all', initialLibraryMode = 'all' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory || 'all');
  const [libraryMode, setLibraryMode] = useState<'all' | 'favorites' | 'recent'>(initialLibraryMode);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [recent, setRecent] = useState<number[]>([]);
  const hero = useMemo(() => findFeatured(channels), [channels]);

  useEffect(() => {
    setFavorites(readIds(FAVORITES_KEY)); setRecent(readIds(RECENT_KEY));
    const onKeyDown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('input[aria-label="جستجوی شبکه"]')?.focus(); } };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const text = [channel.name, channel.nameEn, channel.category, channel.categoryEn, channel.country].filter(Boolean).join(' ').toLocaleLowerCase();
      const matchesLibrary = libraryMode === 'all' || (libraryMode === 'favorites' ? favorites.includes(channel.id) : recent.includes(channel.id));
      return matchesLibrary && (!q || text.includes(q)) && matchesCategory(channel, category);
    });
  }, [channels, query, category, libraryMode, favorites, recent]);

  const popular = useMemo(() => [...filtered].sort((a, b) => b.popular - a.popular || b.sources.length - a.sources.length).slice(0, 10), [filtered]);
  const recentChannels = useMemo(() => recent.map((id) => channels.find((channel) => channel.id === id)).filter((channel): channel is Channel => Boolean(channel)).filter((channel) => !query || `${channel.name} ${channel.nameEn}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [channels, recent, query]);
  const selectedCategories = [['all', 'همه'], ['persian', 'فارسی'], ['news', 'اخبار'], ['sport', 'ورزش'], ['music', 'موسیقی'], ['movie', 'فیلم و سریال'], ['radio', 'رادیو']];
  const markRecent = (id: number) => setRecent((current) => { const next = [id, ...current.filter((value) => value !== id)].slice(0, 30); writeIds(RECENT_KEY, next); return next; });
  const toggleFavorite = (id: number) => setFavorites((current) => { const next = current.includes(id) ? current.filter((value) => value !== id) : [id, ...current].slice(0, 100); writeIds(FAVORITES_KEY, next); return next; });
  const renderRail = (title: string, subtitle: string, items: Channel[]) => !items.length ? null : <section className={styles.section}>
    <div className={styles.sectionHeading}><div><h2>{title}</h2><p>{subtitle}</p></div><button className={styles.seeAllButton} type="button" onClick={() => { setLibraryMode('all'); setCategory('all'); setQuery(''); }}>مشاهده همه</button></div>
    <div className={styles.cardGrid}>{items.slice(0, 10).map((channel) => <ChannelCard key={channel.id} channel={channel} onRecent={markRecent} favorite={favorites.includes(channel.id)} onFavorite={toggleFavorite} />)}</div>
  </section>;

  return <div className={styles.shell}>
    <header className={styles.header}>
      <div className={styles.headerSide}><button className={styles.iconButton} onClick={() => setSidebarOpen((value) => !value)} aria-label="نمایش/مخفی‌کردن منو"><Menu size={22} /></button><Link href="/browse" className={styles.logo}>MOM<span>SAT</span></Link></div>
      <div className={styles.searchWrap}><Search size={19} /><input value={query} onChange={(event) => { setQuery(event.target.value); setLibraryMode('all'); }} placeholder="جستجوی شبکه، ورزش، اخبار، موسیقی..." aria-label="جستجوی شبکه" /><kbd>⌘ K</kbd></div>
      <div className={styles.headerActions}><button className={styles.iconButton} aria-label="اعلان‌ها"><Bell size={20} /></button><Link href="/settings" className={styles.avatarLink} aria-label="تنظیمات"><UserCircle size={29} /></Link></div>
    </header>
    <div className={`${styles.body}${sidebarOpen ? '' : ` ${styles.compact}`}`}>
      <aside className={styles.sidebar}><nav>
        <button className={`${styles.navItem}${libraryMode === 'all' && category === 'all' ? ` ${styles.navItemActive}` : ''}`} onClick={() => { setLibraryMode('all'); setCategory('all'); setQuery(''); }}><Home size={19} /><span>خانه</span></button>
        <Link className={styles.navItem} href="/browse?category=all"><Compass size={19} /><span>کشف شبکه‌ها</span></Link>
        <Link className={styles.navItem} href="/guide"><Radio size={19} /><span>پخش زنده</span></Link>
        <div className={styles.navDivider} /><div className={styles.navLabel}>کتابخانه</div>
        <button className={`${styles.navItem}${libraryMode === 'favorites' ? ` ${styles.navItemActive}` : ''}`} onClick={() => { setLibraryMode('favorites'); setQuery(''); setCategory('all'); }}><Heart size={19} /><span>علاقه‌مندی‌ها</span></button>
        <button className={`${styles.navItem}${libraryMode === 'recent' ? ` ${styles.navItemActive}` : ''}`} onClick={() => { setLibraryMode('recent'); setQuery(''); setCategory('all'); }}><Clock3 size={19} /><span>اخیراً تماشا شده</span></button>
        <div className={styles.navDivider} /><div className={styles.navLabel}>سایر</div><Link className={styles.navItem} href="/settings"><Settings size={19} /><span>تنظیمات</span></Link><Link className={styles.navItem} href="/admin"><Tv size={19} /><span>مدیریت MOMSAT</span></Link>
      </nav></aside>
      <main className={styles.content}>
        {hero && libraryMode === 'all' && !query && category === 'all' ? <section className={styles.hero}><div className={styles.heroImage} style={hero.image ? { backgroundImage: `url("${hero.image.replace(/"/g, '%22')}")` } : undefined} /><div className={styles.heroShade} /><div className={styles.heroContent}><div className={styles.heroEyebrow}><i /> پخش زنده منتخب MOMSAT</div><h1>{hero.name}</h1><p>{hero.nameEn || 'Persian Live Television'} · {hero.category || 'Live TV'} · {hero.sources.length} منبع پخش</p><div className={styles.heroActions}><Link href={`/channel/${hero.id}`} onClick={() => markRecent(hero.id)} className={styles.watchButton}><Play size={17} fill="currentColor" /> تماشا</Link><Link href={`/channel/${hero.id}`} className={styles.infoButton}>جزئیات شبکه</Link></div></div></section> : null}
        <div className={styles.categoryBar}>{selectedCategories.map(([id, label]) => <button key={id} className={`${styles.categoryChip}${category === id ? ` ${styles.categoryActive}` : ''}`} onClick={() => { setCategory(id); setLibraryMode('all'); }}>{label}</button>)}</div>
        {libraryMode === 'all' && !query && category === 'all' ? renderRail('ادامه تماشا', 'شبکه‌هایی که اخیراً باز کرده‌ای', recentChannels) : null}
        {renderRail(libraryMode === 'favorites' ? 'علاقه‌مندی‌های من' : libraryMode === 'recent' ? 'اخیراً تماشا شده' : 'شبکه‌های محبوب', libraryMode === 'favorites' ? 'شبکه‌های ذخیره‌شده روی همین دستگاه' : libraryMode === 'recent' ? 'آخرین شبکه‌هایی که مشاهده کرده‌ای' : 'محبوب‌ترین گزینه‌ها در کاتالوگ فعلی', popular)}
        {libraryMode === 'all' ? renderRail('پخش زنده فارسی', 'کانال‌های فارسی‌زبان برای تماشای فوری', filtered.filter((channel) => channel.language?.toLocaleLowerCase().startsWith('fa') || /فارسی|persian/i.test(`${channel.name} ${channel.nameEn}`)).slice(0, 10)) : null}
        {libraryMode === 'all' ? renderRail('ورزش', 'کانال‌های ورزشی و مسابقات زنده', filtered.filter((channel) => matchesCategory(channel, 'sport')).slice(0, 10)) : null}
        {libraryMode === 'all' ? renderRail('اخبار', 'شبکه‌های خبر و تحلیل', filtered.filter((channel) => matchesCategory(channel, 'news')).slice(0, 10)) : null}
        {libraryMode === 'all' ? renderRail('موسیقی', 'شبکه‌های موزیک و سرگرمی', filtered.filter((channel) => matchesCategory(channel, 'music')).slice(0, 10)) : null}
        <section className={styles.section}><div className={styles.sectionHeading}><div><h2>{libraryMode === 'favorites' ? 'علاقه‌مندی‌های من' : libraryMode === 'recent' ? 'تاریخچه تماشا' : 'همه شبکه‌ها'}</h2><p>{filtered.length} شبکه مطابق انتخاب فعلی</p></div></div><div className={styles.cardGrid}>{filtered.map((channel) => <ChannelCard key={channel.id} channel={channel} onRecent={markRecent} favorite={favorites.includes(channel.id)} onFavorite={toggleFavorite} />)}</div>{!filtered.length ? <div className={styles.emptyState}>شبکه‌ای با این انتخاب پیدا نشد.</div> : null}</section>
      </main>
    </div>
  </div>;
}
