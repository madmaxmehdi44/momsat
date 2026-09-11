'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Clock3, Compass, Film, Globe2, Heart, Home, Menu, Music2, Play, Radio, Search, Settings, Trophy, Tv, UserCircle } from 'lucide-react';
import type { Channel } from '../lib/source';
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
  return (
    <article className={styles.card} style={{ animationDelay: `${Math.min(delay, 12) * 35}ms` }}>
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
        <button className={`${styles.favorite}${favorite ? ` ${styles.favoriteActive}` : ''}`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onFavorite(channel.id); }} aria-label={favorite ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}><Heart size={16} fill={favorite ? 'currentColor' : 'none'} /></button>
        <Link href={`/channel/${channel.id}`} onClick={() => onRecent(channel.id)} className={styles.cardTitle}>{channel.name}</Link>
        <div className={styles.cardMeta}>{channel.category || 'شبکه تلویزیونی'} · {channel.sources.length} منبع</div>
        <div className={styles.cardSub}>{channel.country || 'پخش آنلاین'}{channel.satellite ? ` · ${channel.satellite}` : ''}</div>
      </div>
    </article>
  );
}

function Rail({ title, subtitle, items, favorites, onFavorite, onRecent, onSeeAll }: { title: string; subtitle?: string; items: Channel[]; favorites: number[]; onFavorite: (id: number) => void; onRecent: (id: number) => void; onSeeAll?: () => void }) {
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
          {onSeeAll ? <button className={styles.seeAll} onClick={onSeeAll}>همه</button> : null}
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

  useEffect(() => {
    preloadImages([heroChannel?.image]);
  }, [heroChannel]);

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

  const reset = () => { setQuery(''); setCategory('all'); setLibraryMode('all'); };
  const navCategory = (id: string) => { setLibraryMode('all'); setCategory(id); setQuery(''); };
  const browseActive = libraryMode === 'all' && (Boolean(query) || category !== 'all');
  const homeActive = libraryMode === 'all' && !query && category === 'all';

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerSide}>
          <button className={styles.icon} onClick={() => setSidebarOpen((v) => !v)} aria-label={sidebarOpen ? 'بستن منو' : 'باز کردن منو'} aria-expanded={sidebarOpen}><Menu size={22} /></button>
          <Link href="/browse" className={styles.logo}>MOM<span>SAT</span></Link>
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
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${homeActive ? ` ${styles.navActive}` : ''}`} onClick={reset} aria-current={homeActive ? 'page' : undefined} title="خانه">
                <Home size={19} /><span className={sidebarStyles.navText}><span>خانه</span></span>
              </button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${browseActive ? ` ${styles.navActive}` : ''}`} onClick={reset} aria-current={browseActive ? 'page' : undefined} title="کشف شبکه‌ها">
                <Compass size={19} /><span className={sidebarStyles.navText}><span>کشف شبکه‌ها</span></span>
              </button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${category === 'news' && libraryMode === 'all' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory('news')} aria-current={category === 'news' && libraryMode === 'all' ? 'page' : undefined} title="اخبار زنده">
                <Tv size={19} /><span className={sidebarStyles.navText}><span>اخبار زنده</span><small className={sidebarStyles.navHint}>NEWS</small></span>
              </button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${category === 'persian' && libraryMode === 'all' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory('persian')} aria-current={category === 'persian' && libraryMode === 'all' ? 'page' : undefined} title="شبکه‌های فارسی">
                <Globe2 size={19} /><span className={sidebarStyles.navText}><span>شبکه‌های فارسی</span></span>
              </button>
            </section>

            <div className={sidebarStyles.separator} />

            <section className={sidebarStyles.section}>
              <div className={sidebarStyles.sectionLabel}>کتابخانه من</div>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${libraryMode === 'favorites' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('favorites'); setCategory('all'); setQuery(''); }} aria-current={libraryMode === 'favorites' ? 'page' : undefined} title="علاقه‌مندی‌ها">
                <Heart size={19} /><span className={sidebarStyles.navText}><span>علاقه‌مندی‌ها</span><b className={`${sidebarStyles.badge}${favorites.length ? ` ${sidebarStyles.navActiveBadge}` : ''}`}>{favorites.length}</b></span>
              </button>
              <button className={`${styles.navItem} ${sidebarStyles.navItem}${libraryMode === 'recent' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('recent'); setCategory('all'); setQuery(''); }} aria-current={libraryMode === 'recent' ? 'page' : undefined} title="اخیراً تماشا شده">
                <Clock3 size={19} /><span className={sidebarStyles.navText}><span>اخیراً تماشا شده</span><b className={sidebarStyles.badge}>{recent.length}</b></span>
              </button>
            </section>

            <div className={sidebarStyles.separator} />

            <section className={`${sidebarStyles.section} ${sidebarStyles.desktopOnly}`}>
              <div className={sidebarStyles.sectionLabel}>سرویس</div>
              <Link className={`${styles.navItem} ${sidebarStyles.navItem}`} href="/guide" title="راهنمای پخش"><Radio size={19} /><span className={sidebarStyles.navText}><span>راهنمای پخش</span></span></Link>
              <Link className={`${styles.navItem} ${sidebarStyles.navItem}`} href="/settings" title="تنظیمات"><Settings size={19} /><span className={sidebarStyles.navText}><span>تنظیمات</span></span></Link>
              <Link className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.adminLink}`} href="/admin" title="مدیریت MOMSAT"><Tv size={19} /><span className={sidebarStyles.navText}><span>مدیریت MOMSAT</span></span></Link>
            </section>
          </nav>

          <div className={sidebarStyles.mobileSection} aria-label="ناوبری موبایل">
            <button className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.mobileItem}${homeActive ? ` ${styles.navActive}` : ''}`} onClick={reset} title="خانه"><Home size={18} /><span className={sidebarStyles.navText}><span>خانه</span></span></button>
            <button className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.mobileItem}${browseActive ? ` ${styles.navActive}` : ''}`} onClick={reset} title="کشف"><Compass size={18} /><span className={sidebarStyles.navText}><span>کشف</span></span></button>
            <button className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.mobileItem}${category === 'news' && libraryMode === 'all' ? ` ${styles.navActive}` : ''}`} onClick={() => navCategory('news')} title="اخبار"><Tv size={18} /><span className={sidebarStyles.navText}><span>اخبار</span></span></button>
            <button className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.mobileItem}${libraryMode === 'favorites' ? ` ${styles.navActive}` : ''}`} onClick={() => { setLibraryMode('favorites'); setCategory('all'); setQuery(''); }} title="علاقه‌مندی‌ها"><Heart size={18} /><span className={sidebarStyles.navText}><span>علاقه‌مندی</span></span></button>
            <Link className={`${styles.navItem} ${sidebarStyles.navItem} ${sidebarStyles.mobileItem}`} href="/settings" title="تنظیمات"><Settings size={18} /><span className={sidebarStyles.navText}><span>تنظیمات</span></span></Link>
          </div>
        </aside>

        <main className={styles.content}>
          {homeActive ? (
            <section className={`${styles.hero} ${heroReady ? styles.heroReady : styles.heroLoading}`} aria-busy={!heroReady}>
              <div className={styles.heroImage}>
                {heroChannel?.image ? <img src={heroChannel.image} alt="" fetchPriority="high" decoding="async" onLoad={() => setHeroReady(true)} onError={() => setHeroReady(true)} /> : null}
                {!heroReady && <div className={styles.heroSkeleton}><span /><span /><span /></div>}
              </div>
              <div className={styles.heroShade} />
              <div className={styles.heroContent}>
                <div className={styles.heroEyebrow}><i /> {heroChannel ? 'پخش زنده خبری' : 'پخش زنده'}</div>
                <h1>{heroChannel?.name || 'MOMSAT Live'}</h1>
                <p>{heroChannel ? `${heroChannel.nameEn || heroChannel.name} · اخبار و تحلیل زنده · ${heroChannel.category || 'شبکه تلویزیونی'}` : 'شبکه‌های زنده را همین‌جا پیدا و تماشا کن.'}</p>
                <div className={styles.heroActions}>
                  <Link href={heroChannel ? `/channel/${heroChannel.id}` : '/browse?category=news'} className={styles.watch}><Play size={17} fill="currentColor" /> تماشا</Link>
                  <button className={styles.info} onClick={() => navCategory('news')}>اخبار بیشتر</button>
                </div>
              </div>
              <div className={styles.heroLive}><span /><b>LIVE</b><small>پخش زنده</small></div>
            </section>
          ) : null}

          <div className={styles.categoryBar} aria-label="دسته‌بندی‌ها">
            {CATEGORIES.map((item) => <button key={item.id} className={`${styles.categoryChip}${category === item.id ? ` ${styles.categorySelected}` : ''}`} onClick={() => navCategory(item.id)}><span className={styles.categoryIcon}>{item.icon}</span><span>{item.label}</span><em>{counts[item.id]}</em></button>)}
          </div>

          {homeActive ? <Rail title="اخیراً تماشا شده" subtitle="سریع به شبکه‌های قبلی برگرد" items={recentChannels} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => setLibraryMode('recent')} /> : null}
          {libraryMode === 'favorites' ? <Rail title="علاقه‌مندی‌های من" subtitle="شبکه‌های ذخیره‌شده روی این دستگاه" items={filtered} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} /> : null}
          {libraryMode === 'recent' ? <Rail title="تاریخچه تماشا" subtitle="آخرین شبکه‌هایی که باز کرده‌ای" items={filtered} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} /> : null}
          {libraryMode === 'all' ? <Rail title="محبوب‌ترین شبکه‌ها" subtitle="اولویت با کانال‌های پرامتیاز و دارای مسیرهای بیشتر" items={popular} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} /> : null}
          {libraryMode === 'all' ? <Rail title="اخبار" subtitle="شبکه‌های خبری و تحلیل" items={news} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('news')} /> : null}
          {libraryMode === 'all' ? <Rail title="شبکه‌های فارسی" subtitle="پخش زنده فارسی‌زبان" items={persian} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('persian')} /> : null}
          {libraryMode === 'all' ? <Rail title="ورزش" subtitle="شبکه‌های ورزشی و مسابقات" items={sports} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('sport')} /> : null}
          {libraryMode === 'all' ? <Rail title="موسیقی" subtitle="موزیک و سرگرمی" items={music} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('music')} /> : null}
          {libraryMode === 'all' ? <Rail title="فیلم و سریال" subtitle="شبکه‌های فیلم و سریال" items={movies} favorites={favorites} onFavorite={toggleFavorite} onRecent={markRecent} onSeeAll={() => navCategory('movie')} /> : null}

          <section className={styles.gridSection}>
            <div className={styles.gridHeading}>
              <div>
                <h2>{query ? `نتایج جستجو برای «${query}»` : category !== 'all' ? CATEGORIES.find((c) => c.id === category)?.label : 'همه شبکه‌ها'}</h2>
                <p>{filtered.length.toLocaleString('fa-IR')} شبکه</p>
              </div>
              {!homeActive ? <button onClick={reset}>پاک‌کردن فیلترها</button> : null}
            </div>
            <div className={styles.grid}>{filtered.map((channel, index) => <Card key={channel.id} channel={channel} favorite={favorites.includes(channel.id)} onFavorite={toggleFavorite} onRecent={markRecent} delay={index} />)}</div>
            {!filtered.length && <div className={styles.empty}><Search size={24} /><strong>شبکه‌ای پیدا نشد</strong><span>فیلتر یا عبارت جستجو را تغییر بده.</span><button onClick={reset}>بازگشت به خانه</button></div>}
          </section>
        </main>
      </div>
    </div>
  );
}
