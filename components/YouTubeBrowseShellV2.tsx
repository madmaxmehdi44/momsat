'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Compass, Film, Globe2, Heart, Home, Menu, Music2, Play, Radio, Search, Settings, Trophy, Tv, UserCircle } from 'lucide-react';
import type { Channel } from '../lib/source';
import { useRouter } from 'next/navigation';
import { usePersistentPlayer } from './PersistentPlayerProvider';
import styles from './YouTubeBrowseShellV2.module.css';
import sidebarStyles from './YouTubeBrowseSidebar.module.css';

type Props = { channels: Channel[]; initialQuery?: string; initialCategory?: string; initialLibraryMode?: 'all' | 'favorites' | 'recent' };
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';

type Category = { id: string; label: string; icon: React.ReactNode };
const CATEGORIES: Category[] = [
  { id: 'all', label: 'همه', icon: <Home size={16} /> },
  { id: 'persian', label: 'فارسی', icon: <Globe2 size={16} /> },
  { id: 'news', label: 'اخبار', icon: <Tv size={16} /> },
  { id: 'sport', label: 'ورزش', icon: <Trophy size={16} /> },
  { id: 'music', label: 'موسیقی', icon: <Music2 size={16} /> },
  { id: 'movie', label: 'فیلم و سریال', icon: <Film size={16} /> },
  { id: 'radio', label: 'رادیو', icon: <Radio size={16} /> },
];

function readIds(key: string) {
  if (typeof window === 'undefined') return [] as number[];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
  } catch { return []; }
}

function writeIds(key: string, ids: number[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* ignore */ }
}

function isRadioChannel(channel: Channel) {
  const value = `${channel.name} ${channel.nameEn} ${channel.category} ${channel.categoryEn}`;
  return /radio|رادیو|audio|آوا/i.test(value);
}

function getIranInternationalTv(channels: Channel[]) {
  const candidates = channels.filter((c) => /iran\s*international|ایران\s*اینترنشنال/i.test(`${c.name} ${c.nameEn}`));
  const scored = candidates
    .filter((c) => !isRadioChannel(c))
    .map((c) => {
      const value = `${c.name} ${c.nameEn} ${c.category} ${c.categoryEn}`;
      let score = 0;
      if (c.name.trim().toLocaleLowerCase() === 'iran international') score += 1000;
      if (/news|خبر|khabar/i.test(value)) score += 300;
      if (/tv|television|تلویزیون/i.test(value)) score += 220;
      if ((c.sources?.length ?? 0) > 0) score += 80;
      if ((c.url || '').includes('.m3u8')) score += 60;
      return { c, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.c ?? null;
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

function titleText(channel: Channel) {
  return `${channel.name} ${channel.nameEn} ${channel.category} ${channel.categoryEn} ${channel.country}`.toLocaleLowerCase();
}

function preloadImages(urls: Array<string | null | undefined>) {
  const unique = Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
  unique.forEach((url) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
  });
}

function Card({ channel, favorite, onFavorite, onRecent, delay = 0 }: { channel: Channel; favorite: boolean; onFavorite: (id: number) => void; onRecent: (id: number) => void; delay?: number }) {
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const { play } = usePersistentPlayer();

  const handleOpen = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onRecent(channel.id);
    play({
      channelId: channel.id,
      channelName: channel.name,
      url: channel.url,
      referer: channel.referer,
      origin: channel.origin,
      image: channel.image,
    });
    router.push(`/?playing=${channel.id}`);
  };

  return (
    <article className={styles.card} style={{ animationDelay: `${Math.min(delay, 12) * 35}ms` }}>
      <Link href={`/?playing=${channel.id}`} className={styles.cardLink} onClick={handleOpen}>
        <div className={`${styles.thumb} ${loaded ? styles.thumbLoaded : ''}`}>
          {!loaded && <div className={styles.thumbSkeleton}><span /></div>}
          {channel.image ? <img src={channel.image} alt="" loading="lazy" decoding="async" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} /> : <div className={styles.fallback}>{(channel.nameEn || channel.name).slice(0, 3).toUpperCase()}</div>}
          <span className={styles.live}><i /> LIVE</span>
          {channel.vip ? <span className={styles.vip}>VIP</span> : null}
          <span className={styles.hoverPlay}><Play size={18} fill="currentColor" /></span>
        </div>
      </Link>
      <div className={styles.cardInfo}>
        <button className={`${styles.favorite}${favorite ? ` ${styles.favoriteActive}` : ''}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onFavorite(channel.id); }} aria-label={favorite ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <button type="button" onClick={() => { onRecent(channel.id); play({ channelId: channel.id, channelName: channel.name, url: channel.url, referer: channel.referer, origin: channel.origin, image: channel.image }); router.push(`/?playing=${channel.id}`); }} className={styles.cardTitle}>{channel.name}</button>
        <div className={styles.cardMeta}>{channel.category || 'شبکه تلویزیونی'} · {channel.sources.length} منبع</div>
        <div className={styles.cardSub}>{channel.country || 'پخش آنلاین'}{channel.satellite ? ` · ${channel.satellite}` : ''}</div>
      </div>
    </article>
  );
}

function Rail({ title, subtitle, items, favorites, onFavorite, onRecent }: { title: string; subtitle?: string; items: Channel[]; favorites: number[]; onFavorite: (id: number) => void; onRecent: (id: number) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  if (!items.length) return null;
  const scroll = (dir: number) => viewportRef.current?.scrollBy({ left: dir * Math.max(420, viewportRef.current.clientWidth * 0.8), behavior: 'smooth' });
  return (
    <section className={styles.rail}>
      <div className={styles.railHeader}>
        <div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div>
        <div className={styles.railActions}>
          <button onClick={() => scroll(1)} aria-label="بعدی"><ChevronRight size={18} /></button>
          <button onClick={() => scroll(-1)} aria-label="قبلی"><ChevronLeft size={18} /></button>
        </div>
      </div>
      <div className={styles.railViewport} ref={viewportRef}>
        {items.slice(0, 12).map((channel, index) => <div className={styles.railCard} key={channel.id}><Card channel={channel} favorite={favorites.includes(channel.id)} onFavorite={onFavorite} onRecent={onRecent} delay={index} /></div>)}
      </div>
    </section>
  );
}

export default function YouTubeBrowseShellV2({ channels, initialQuery = '', initialCategory = 'all', initialLibraryMode = 'all' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory || 'all');
  const [libraryMode, setLibraryMode] = useState<'all' | 'favorites' | 'recent'>(initialLibraryMode);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [favorites, setFavorites] = useState<number[]>([]);
  const [recent, setRecent] = useState<number[]>([]);
  const [heroReady, setHeroReady] = useState(false);
  const router = useRouter();
  const { play } = usePersistentPlayer();

  useEffect(() => {
    setFavorites(readIds(FAVORITES_KEY));
    setRecent(readIds(RECENT_KEY));
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input[aria-label="جستجوی شبکه"]')?.focus();
      }
      if (event.key === 'Escape') document.querySelector<HTMLInputElement>('input[aria-label="جستجوی شبکه"]')?.blur();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const iranInternational = useMemo(() => getIranInternationalTv(channels), [channels]);
  const heroChannel = useMemo(() => iranInternational ?? channels.find((channel) => matches(channel, 'news')) ?? channels[0] ?? null, [channels, iranInternational]);

  useEffect(() => { preloadImages([heroChannel?.image]); }, [heroChannel]);

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

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: channels.length, persian: 0, news: 0, sport: 0, music: 0, movie: 0, radio: 0 };
    for (const channel of channels) {
      if (matches(channel, 'persian')) map.persian += 1;
      if (matches(channel, 'news')) map.news += 1;
      if (matches(channel, 'sport')) map.sport += 1;
      if (matches(channel, 'music')) map.music += 1;
      if (matches(channel, 'movie')) map.movie += 1;
      if (matches(channel, 'radio')) map.radio += 1;
    }
    return map;
  }, [channels]);

  const markRecent = (id: number) => setRecent((current) => {
    const next = [id, ...current.filter((x) => x !== id)].slice(0, 30);
    writeIds(RECENT_KEY, next);
    return next;
  });

  const toggleFavorite = (id: number) => setFavorites((current) => {
    const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current].slice(0, 100);
    writeIds(FAVORITES_KEY, next);
    return next;
  });

  const reset = () => { setQuery(''); setCategory('all'); setLibraryMode('all'); router.replace('/'); };
  const navCategory = (id: string) => { setLibraryMode('all'); setCategory(id); setQuery(''); router.replace(`/?category=${encodeURIComponent(id)}`); };
  const browseActive = libraryMode === 'all' && (Boolean(query) || category !== 'all');
  const homeActive = libraryMode === 'all' && !query && category === 'all';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerSide}>
          <button className={styles.icon} onClick={() => setSidebarOpen((v) => !v)} aria-label={sidebarOpen ? 'بستن منو' : 'باز کردن منو'} aria-expanded={sidebarOpen}><Menu size={22} /></button>
          <button type="button" className={styles.logo} onClick={reset}>MOM<span>SAT</span></button>
        </div>
        <div className={styles.search}>
          <Search size={19} />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setLibraryMode('all'); }} placeholder="جستجوی شبکه، اخبار، ورزش، موسیقی…" aria-label="جستجوی شبکه" />
          <kbd>Ctrl/⌘ K</kbd>
        </div>
        <div className={styles.headerActions}>
          <Link className={styles.avatar} href="/settings" aria-label="تنظیمات"><UserCircle size={28} /></Link>
        </div>
      </header>

      <div className={`${styles.body}${sidebarOpen ? '' : ` ${styles.compact}`} ${sidebarStyles.bodyRtl}`}>
        <aside className={`${styles.sidebar} ${sidebarStyles.sidebarPro}`} data-collapsed={!sidebarOpen}>
          <div className={sidebarStyles.brand}>
            <div className={sidebarStyles.brandMark}>
              <span className={sidebarStyles.brandDot} />
              <div className={sidebarStyles.brandText}><strong>MOMSAT LIVE</strong><span>تلویزیون زنده · 24/7</span></div>
            </div>
            <span className={sidebarStyles.status}><i /> زنده</span>
          </div>
          <nav aria-label="ناوبری اصلی">
            <section className={sidebarStyles.section}>
              <div className={sidebarStyles.sectionLabel}>محتوا</div>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${homeActive ? ` ${styles.navActive}` : ''}`} onClick={reset} aria-current={homeActive ? 'page' : undefined} title="خانه"><Home size={19} /><span className={sidebarStyles.navText}><span>خانه</span></span></button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${browseActive ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('all'); }} aria-current={browseActive ? 'page' : undefined} title="کشف شبکه‌ها"><Compass size={19} /><span className={sidebarStyles.navText}><span>کشف شبکه‌ها</span></span></button>
              {CATEGORIES.filter((category) => category.id !== 'all').map((item) => <button key={item.id} className={`${styles.navItem} ${sidebarStyles.navItem}${category === item.id && libraryMode === 'all' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory(item.id)} title={item.label}>{item.icon}<span className={sidebarStyles.navText}><span>{item.label}</span><em>{counts[item.id]}</em></span></button>)}
            </section>
            <section className={sidebarStyles.section}>
              <div className={sidebarStyles.sectionLabel}>کتابخانه</div>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${libraryMode === 'favorites' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('favorites'); setQuery(''); router.replace('/?favorites=1'); }} title="علاقه‌مندی‌ها"><Heart size={19} /><span className={sidebarStyles.navText}><span>علاقه‌مندی‌ها</span><em>{favorites.length}</em></span></button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${libraryMode === 'recent' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('recent'); setQuery(''); router.replace('/?recent=1'); }} title="اخیراً تماشا شده"><Clock3 size={19} /><span className={sidebarStyles.navText}><span>اخیراً تماشا شده</span></span></button>
            </section>
            <section className={sidebarStyles.section}>
              <div className={sidebarStyles.sectionLabel}>سیستم</div>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}`} onClick={() => router.push('/settings')} title="تنظیمات"><Settings size={19} /><span className={sidebarStyles.navText}><span>تنظیمات</span></span></button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}`} onClick={() => router.push('/admin')} title="مدیریت MOMSAT"><Tv size={19} /><span className={sidebarStyles.navText}><span>مدیریت MOMSAT</span></span></button>
            </section>
          </nav>
        </aside>

        <main className={styles.main}>
          <section className={styles.hero}>
            <div className={styles.heroContent}>
              <div className={styles.heroEyebrow}>پخش زنده · MOMSAT</div>
              <h1>تلویزیون زنده، همین حالا</h1>
              <p>{heroChannel ? `پخش مستقیم ${heroChannel.name}` : 'شبکه‌های زنده را جستجو و تماشا کنید.'}</p>
              {heroChannel ? <button type="button" className={styles.heroButton} onClick={() => { markRecent(heroChannel.id); play({ channelId: heroChannel.id, channelName: heroChannel.name, url: heroChannel.url, referer: heroChannel.referer, origin: heroChannel.origin, image: heroChannel.image }); router.push(`/?playing=${heroChannel.id}`); }}><Play size={17} fill="currentColor" /> تماشای زنده</button> : null}
            </div>
            <div className={styles.heroVisual}>{heroChannel?.image ? <img src={heroChannel.image} alt="" onLoad={() => setHeroReady(true)} /> : null}{!heroReady && heroChannel ? <div className={styles.heroSkeleton} /> : null}</div>
          </section>

          <Rail title="محبوب‌ترین شبکه‌ها" subtitle="پخش‌های زنده پرطرفدار" items={popular} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
          <Rail title="اخبار" subtitle="شبکه‌های خبری زنده" items={news} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
          <Rail title="شبکه‌های فارسی" subtitle="پخش‌های فارسی" items={persian} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
          <Rail title="ورزش" subtitle="شبکه‌های ورزشی زنده" items={sports} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
          <Rail title="موسیقی" subtitle="موسیقی زنده" items={music} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
          <Rail title="فیلم و سریال" subtitle="کانال‌های فیلم و سریال" items={movies} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} />
        </main>
      </div>

      <nav className={styles.mobileNav} aria-label="ناوبری اصلی">
        <button onClick={reset} className={`${styles.mobileItem}${homeActive ? ` ${styles.mobileActive}` : ''}`}><Home size={18} /><span>خانه</span></button>
        <button onClick={() => { setLibraryMode('all'); }} className={`${styles.mobileItem}${browseActive ? ` ${styles.mobileActive}` : ''}`}><Compass size={18} /><span>کشف</span></button>
        <button onClick={() => { setLibraryMode('favorites'); router.replace('/?favorites=1'); }} className={`${styles.mobileItem}${libraryMode === 'favorites' ? ` ${styles.mobileActive}` : ''}`}><Heart size={18} /><span>علاقه‌مندی</span></button>
        <button onClick={() => { setLibraryMode('recent'); router.replace('/?recent=1'); }} className={`${styles.mobileItem}${libraryMode === 'recent' ? ` ${styles.mobileActive}` : ''}`}><Clock3 size={18} /><span>اخیراً</span></button>
        <button onClick={() => router.push('/settings')} className={styles.mobileItem}><UserCircle size={18} /><span>تنظیمات</span></button>
      </nav>

      <div className={styles.playerHost} aria-live="polite" />
    </div>
  );
}
