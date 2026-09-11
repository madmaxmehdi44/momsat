'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, Check, ChevronLeft, ChevronRight, Clock3, Compass, Heart, Home, Menu, Play, Radio, Search, Settings, Tv, UserCircle } from 'lucide-react';
import type { Channel } from '../lib/source';
import { usePersistentPlayer } from './PersistentPlayerProvider';
import styles from './YouTubeBrowseShellV2.module.css';

type Props = { channels: Channel[]; initialQuery?: string; initialCategory?: string; initialLibraryMode?: 'all' | 'favorites' | 'recent' };
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';
const PERSISTENT_PLAYER_KEY = 'momsat.persistent-player.v1';

type Category = { id: string; label: string; icon: React.ReactNode };
const CATEGORIES: Category[] = [
  { id: 'all', label: 'همه', icon: <Home size={16} /> },
  { id: 'persian', label: 'فارسی', icon: <Radio size={16} /> },
  { id: 'news', label: 'اخبار', icon: <Tv size={16} /> },
  { id: 'sport', label: 'ورزش', icon: <Play size={16} /> },
  { id: 'music', label: 'موسیقی', icon: <Radio size={16} /> },
  { id: 'movie', label: 'فیلم و سریال', icon: <Tv size={16} /> },
  { id: 'radio', label: 'رادیو', icon: <Radio size={16} /> },
];

function readIds(key: string) {
  if (typeof window === 'undefined') return [] as number[];
  try { const value = JSON.parse(window.localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []; } catch { return []; }
}
function writeIds(key: string, ids: number[]) { try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ } }

function getIranInternationalTv(channels: Channel[]) {
  const exact = channels.find((c) => c.name.trim().toLocaleLowerCase() === 'iran international' && !/radio|رادیو/i.test(`${c.name} ${c.nameEn}`));
  if (exact) return exact;
  return channels.find((c) => /iran\s*international|ایران\s*اینترنشنال/i.test(`${c.name} ${c.nameEn}`) && !/radio|رادیو/i.test(`${c.name} ${c.nameEn}`)) ?? null;
}
function matches(channel: Channel, category: string) {
  if (category === 'all') return true;
  const value = `${channel.category} ${channel.categoryEn} ${channel.name} ${channel.nameEn}`.toLocaleLowerCase();
  if (category === 'news') return /news|خبر|khabar/.test(value);
  if (category === 'sport') return /sport|ورزش|football|soccer|bein/.test(value);
  if (category === 'music') return /music|موسیقی|موزیک/.test(value);
  if (category === 'movie') return /movie|film|فیلم|cinema|سینما|series|سریال/.test(value);
  if (category === 'radio') return /radio|رادیو/.test(value);
  if (category === 'persian') return channel.language?.toLocaleLowerCase().startsWith('fa') || /فارسی|persian/.test(value);
  return true;
}
function titleText(channel: Channel) { return `${channel.name} ${channel.nameEn} ${channel.category} ${channel.categoryEn} ${channel.country}`.toLocaleLowerCase(); }

function Card({ channel, favorite, onFavorite, onRecent }: { channel: Channel; favorite: boolean; onFavorite: (id: number) => void; onRecent: (id: number) => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <article className={styles.card}>
      <Link href={`/channel/${channel.id}`} className={styles.cardLink} onClick={() => onRecent(channel.id)}>
        <div className={`${styles.thumb} ${loaded ? styles.thumbLoaded : ''}`}>
          {!loaded && <div className={styles.thumbSkeleton}><span /></div>}
          {channel.image ? <img src={channel.image} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} /> : <div className={styles.fallback}>{(channel.nameEn || channel.name).slice(0, 3).toUpperCase()}</div>}
          <span className={styles.live}><i /> LIVE</span>
          {channel.vip ? <span className={styles.vip}>VIP</span> : null}
          <span className={styles.hoverPlay}><Play size={18} fill="currentColor" /></span>
        </div>
      </Link>
      <div className={styles.cardInfo}>
        <button className={`${styles.favorite}${favorite ? ` ${styles.favoriteActive}` : ''}`} onClick={() => onFavorite(channel.id)} aria-label={favorite ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <Link href={`/channel/${channel.id}`} onClick={() => onRecent(channel.id)} className={styles.cardTitle}>{channel.name}</Link>
        <div className={styles.cardMeta}>{channel.category || 'شبکه تلویزیونی'} · {channel.sources.length} منبع</div>
        <div className={styles.cardSub}>{channel.country || 'پخش آنلاین'}{channel.satellite ? ` · ${channel.satellite}` : ''}</div>
      </div>
    </article>
  );
}

function Rail({ title, subtitle, items, favorites, onFavorite, onRecent, onSeeAll }: { title: string; subtitle?: string; items: Channel[]; favorites: number[]; onFavorite: (id: number) => void; onRecent: (id: number) => void; onSeeAll: () => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (dir: number) => viewportRef.current?.scrollBy({ left: dir * Math.max(420, viewportRef.current.clientWidth * 0.8), behavior: 'smooth' });
  return (
    <section className={styles.rail}>
      <div className={styles.railHeader}>
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <div className={styles.railActions}><button onClick={() => scroll(1)} aria-label="بعدی"><ChevronRight size={18} /></button><button onClick={() => scroll(-1)} aria-label="قبلی"><ChevronLeft size={18} /></button><button className={styles.seeAll} onClick={onSeeAll}>همه</button></div>
      </div>
      <div className={styles.railViewport} ref={viewportRef}>{items.map((channel) => <div className={styles.railCard} key={channel.id}><Card channel={channel} favorite={favorites.includes(channel.id)} onFavorite={onFavorite} onRecent={onRecent} /></div>)}</div>
    </section>
  );
}

export default function YouTubeBrowseShellV2({ channels, initialQuery = '', initialCategory = 'all', initialLibraryMode = 'all' }: Props) {
  const { setActiveChannel } = usePersistentPlayer();
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory || 'all');
  const [libraryMode, setLibraryMode] = useState<'all' | 'favorites' | 'recent'>(initialLibraryMode);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [recent, setRecent] = useState<number[]>([]);
  const [heroReady, setHeroReady] = useState(false);

  useEffect(() => {
    setFavorites(readIds(FAVORITES_KEY));
    setRecent(readIds(RECENT_KEY));
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); document.querySelector<HTMLInputElement>('input[aria-label="جستجوی شبکه"]')?.focus(); }
      if (event.key === 'Escape') document.querySelector<HTMLInputElement>('input[aria-label="جستجوی شبکه"]')?.blur();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const iranInternational = useMemo(() => getIranInternationalTv(channels), [channels]);
  useEffect(() => {
    if (!iranInternational) return;
    const preload = new Image();
    preload.onload = () => setHeroReady(true);
    preload.onerror = () => setHeroReady(true);
    if (iranInternational.image) preload.src = iranInternational.image;
    else setHeroReady(true);
    setActiveChannel(iranInternational);
  }, [iranInternational, setActiveChannel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const inLibrary = libraryMode === 'all' || (libraryMode === 'favorites' ? favorites.includes(channel.id) : recent.includes(channel.id));
      return inLibrary && (!q || titleText(channel).includes(q)) && matches(channel, category);
    });
  }, [channels, query, category, libraryMode, favorites, recent]);

  const recentChannels = useMemo(() => recent.map((id) => channels.find((c) => c.id === id)).filter((c): c is Channel => Boolean(c)), [channels, recent]);
  const popular = useMemo(() => [...filtered].sort((a, b) => b.popular - a.popular || b.sources.length - a.sources.length), [filtered]);
  const news = useMemo(() => filtered.filter((c) => matches(c, 'news')), [filtered]);
  const persian = useMemo(() => filtered.filter((c) => matches(c, 'persian')), [filtered]);
  const sports = useMemo(() => filtered.filter((c) => matches(c, 'sport')), [filtered]);
  const music = useMemo(() => filtered.filter((c) => matches(c, 'music')), [filtered]);
  const movies = useMemo(() => filtered.filter((c) => matches(c, 'movie')), [filtered]);

  useEffect(() => {
    if (!iranInternational?.image) return;
    const image = new Image();
    image.src = iranInternational.image;
  }, [iranInternational]);

  const markRecent = (id: number) => setRecent((current) => { const next = [id, ...current.filter((x) => x !== id)].slice(0, 30); writeIds(RECENT_KEY, next); return next; });
  const toggleFavorite = (id: number) => setFavorites((current) => { const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current].slice(0, 100); writeIds(FAVORITES_KEY, next); return next; });
  const reset = () => { setQuery(''); setCategory('all'); setLibraryMode('all'); };

  const navCategory = (id: string) => { setLibraryMode('all'); setCategory(id); setQuery(''); };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerSide}><button className={styles.icon} onClick={() => setSidebarOpen((v) => !v)} aria-label="منو"><Menu size={22} /></button><Link href="/browse" className={styles.logo}>MOM<span>SAT</span></Link></div>
        <div className={styles.search}><Search size={19} /><input value={query} onChange={(e) => { setQuery(e.target.value); setLibraryMode('all'); }} placeholder="جستجوی شبکه، اخبار، ورزش، موسیقی…" aria-label="جستجوی شبکه"/><kbd>⌘ K</kbd></div>
        <div className={styles.headerActions}><button className={styles.icon} aria-label="اعلان"><Bell size={20} /></button><Link className={styles.avatar} href="/settings" aria-label="تنظیمات"><UserCircle size={28}/></Link></div>
      </header>

      <div className={`${styles.body}${sidebarOpen ? '' : ` ${styles.compact}`}`}>
        <aside className={styles.sidebar}><nav>
          <button className={`${styles.navItem}${libraryMode === 'all' && category === 'all' ? ` ${styles.navActive}` : ''}`} onClick={reset}><Home size={19}/><span>خانه</span></button>
          <button className={`${styles.navItem}${category === 'all' && libraryMode === 'all' && query ? ` ${styles.navActive}` : ''}`} onClick={() => { setQuery(''); setCategory('all'); setLibraryMode('all'); }}><Compass size={19}/><span>کشف شبکه‌ها</span></button>
          <button className={`${styles.navItem}${category === 'news' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory('news')}><Tv size={19}/><span>اخبار زنده</span></button>
          <button className={`${styles.navItem}${category === 'persian' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory('persian')}><Radio size={19}/><span>شبکه‌های فارسی</span></button>
          <div className={styles.divider}/><div className={styles.label}>کتابخانه</div>
          <button className={`${styles.navItem}${libraryMode === 'favorites' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('favorites'); setCategory('all'); setQuery(''); }}><Heart size={19}/><span>علاقه‌مندی‌ها</span></button>
          <button className={`${styles.navItem}${libraryMode === 'recent' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('recent'); setCategory('all'); setQuery(''); }}><Clock3 size={19}/><span>اخیراً تماشا شده</span></button>
          <div className={styles.divider}/><div className={styles.label}>سایر</div>
          <Link className={styles.navItem} href="/guide"><Radio size={19}/><span>راهنمای پخش</span></Link>
          <Link className={styles.navItem} href="/settings"><Settings size={19}/><span>تنظیمات</span></Link>
          <Link className={styles.navItem} href="/admin"><Tv size={19}/><span>مدیریت MOMSAT</span></Link>
        </nav></aside>

        <main className={styles.content}>
          {libraryMode === 'all' && !query && category === 'all' ? (
            <section className={`${styles.hero} ${heroReady ? styles.heroReady : styles.heroLoading}`}>
              <div className={styles.heroImage}>{iranInternational?.image ? <img src={iranInternational.image} alt="" fetchPriority="high" decoding="async" onLoad={() => setHeroReady(true)} onError={() => setHeroReady(true)} /> : null}</div>
              <div className={styles.heroShade}/>
              <div className={styles.heroContent}>
                <div className={styles.heroEyebrow}><i/> پخش زنده خبری</div>
                <h1>{iranInternational?.name || 'Iran International'}</h1>
                <p>Iran International · اخبار و تحلیل زنده · شبکه تلویزیونی</p>
                <div className={styles.heroActions}><Link href={iranInternational ? `/channel/${iranInternational.id}` : '/browse?category=news'} className={styles.watch}><Play size={17} fill="currentColor"/> تماشا</Link><button className={styles.info} onClick={() => navCategory('news')}>اخبار بیشتر</button></div>
              </div>
              <div className={styles.heroLive}><span/><b>LIVE</b><small>پخش زنده</small></div>
            </section>
          ) : null}

          <div className={styles.categoryBar}>
            {CATEGORIES.map((item) => <button key={item.id} className={`${styles.categoryChip}${category === item.id ? ` ${styles.categorySelected}` : ''}`} onClick={() => navCategory(item.id)}>{item.icon}<span>{item.label}</span></button>)}
          </div>

          {libraryMode === 'all' && !query && category === 'all' ? <Rail title="اخیراً تماشا شده" subtitle="سریع به شبکه‌های قبلی برگرد" items={recentChannels} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => setLibraryMode('recent')} /> : null}
          {libraryMode === 'favorites' ? <Rail title="علاقه‌مندی‌های من" subtitle="شبکه‌های ذخیره‌شده روی این دستگاه" items={filtered} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => {}} /> : null}
          {libraryMode === 'recent' ? <Rail title="تاریخچه تماشا" subtitle="آخرین شبکه‌هایی که باز کرده‌ای" items={filtered} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => {}} /> : null}
          {libraryMode === 'all' ? <Rail title="محبوب‌ترین شبکه‌ها" subtitle="انتخاب‌شده بر اساس محبوبیت و مسیرهای پخش" items={popular} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => setCategory('all')} /> : null}
          {libraryMode === 'all' ? <Rail title="اخبار" subtitle="شبکه‌های خبری و تحلیل" items={news} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('news')} /> : null}
          {libraryMode === 'all' ? <Rail title="شبکه‌های فارسی" subtitle="پخش زنده فارسی‌زبان" items={persian} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('persian')} /> : null}
          {libraryMode === 'all' ? <Rail title="ورزش" subtitle="شبکه‌های ورزشی و مسابقات" items={sports} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('sport')} /> : null}
          {libraryMode === 'all' ? <Rail title="موسیقی" subtitle="موزیک و سرگرمی" items={music} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('music')} /> : null}
          {libraryMode === 'all' ? <Rail title="فیلم و سریال" subtitle="شبکه‌های فیلم و سریال" items={movies} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('movie')} /> : null}

          <section className={styles.gridSection}><div className={styles.gridHeading}><div><h2>{query ? `نتایج جستجو برای «${query}»` : category !== 'all' ? CATEGORIES.find((c) => c.id === category)?.label : 'همه شبکه‌ها'}</h2><p>{filtered.length.toLocaleString('fa-IR')} شبکه</p></div><button onClick={reset}>پاک‌کردن فیلترها</button></div><div className={styles.grid}>{filtered.map((channel) => <Card key={channel.id} channel={channel} favorite={favorites.includes(channel.id)} onFavorite={toggleFavorite} onRecent={markRecent} />)}</div>{!filtered.length && <div className={styles.empty}><Search size={24}/><strong>شبکه‌ای پیدا نشد</strong><span>فیلتر یا عبارت جستجو را تغییر بده.</span><button onClick={reset}>بازگشت به خانه</button></div>}</section>
        </main>
      </div>
    </div>
  );
}
