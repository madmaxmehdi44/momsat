'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Channel } from '../lib/source';
import { getLiveThumbnail, setLiveThumbnail, type LiveThumbnailEntry } from '../lib/live-thumbnail-cache';
import styles from './LiveChannelCatalog.module.css';

type Props = { channels: Channel[]; initialQuery?: string; initialCategory?: string };
type Status = 'online' | 'offline' | 'loading';
type Snapshot = { dataUrl: string | null; status: Status; cachedAt?: number };
type Candidate = { url: string; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Connection = { effectiveType?: string; downlink?: number; saveData?: boolean; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };

type Rail = { key: string; title: string; subtitle: string; items: Channel[]; accent?: boolean };

const SNAPSHOT_TTL = 120_000;
const CAPTURE_TIMEOUT = 6_000;
const MAX_SOURCES = 4;
const FAVORITES_KEY = 'momsat:favorites:v1';
const RECENT_KEY = 'momsat:recent:v1';

function concurrency(): number {
  if (typeof navigator === 'undefined') return 2;
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  if (c?.saveData || /2g/i.test(c?.effectiveType || '') || (c?.downlink ?? 10) < 1) return 1;
  if (/3g/i.test(c?.effectiveType || '') || (c?.downlink ?? 10) < 3) return 2;
  return 3;
}

function candidates(channel: Channel): Candidate[] {
  const all: Candidate[] = [
    { url: channel.url, referer: channel.referer, origin: channel.origin, country: channel.country, vip: channel.vip },
    ...(channel.sources ?? []).map((s) => ({ url: s.url, referer: s.referer, origin: s.origin, country: s.country, vip: s.vip })),
  ];
  const unique = new Map<string, Candidate>();
  for (const item of all) {
    const url = String(item.url || '').trim();
    if (url && !unique.has(url)) unique.set(url, { ...item, url });
  }
  return Array.from(unique.values()).slice(0, MAX_SOURCES);
}

function proxyUrl(candidate: Candidate, channel: Channel): string {
  if (/^\/api\/stream\?/i.test(candidate.url)) return candidate.url;
  const params = new URLSearchParams({ url: candidate.url });
  if (candidate.referer || channel.referer) params.set('referer', candidate.referer || channel.referer || '');
  if (candidate.origin || channel.origin) params.set('origin', candidate.origin || channel.origin || '');
  return `/api/stream?${params.toString()}`;
}

async function capture(channel: Channel): Promise<{ dataUrl: string; sourceUrl: string } | null> {
  for (const candidate of candidates(channel)) {
    const url = proxyUrl(candidate, channel);
    const video = document.createElement('video');
    const hlsInstances: Hls[] = [];
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:2px;height:2px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    try {
      const loaded = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(value); };
        const timer = window.setTimeout(() => finish(false), CAPTURE_TIMEOUT);
        video.addEventListener('loadeddata', () => finish(true), { once: true });
        video.addEventListener('canplay', () => finish(true), { once: true });
        video.addEventListener('error', () => finish(false), { once: true });
        if (/\.m3u8(?:$|[?#])/i.test(url)) {
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 6, maxBufferLength: 6, maxMaxBufferLength: 10, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, manifestLoadingTimeOut: 3500, levelLoadingTimeOut: 3500, fragLoadingTimeOut: 4000 });
            hlsInstances.push(hls);
            hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) finish(false); });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
          else finish(false);
        } else video.src = url;
        void video.play().catch(() => undefined);
      });
      if (!loaded || !video.videoWidth || !video.videoHeight) continue;
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = Math.max(270, Math.round((480 * video.videoHeight) / video.videoWidth));
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length < 1000) continue;
      return { dataUrl, sourceUrl: url };
    } catch {
      // Try the next source.
    } finally {
      for (const instance of hlsInstances) { try { instance.destroy(); } catch { /* ignore cleanup errors */ } }
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
  }
  return null;
}

function readIds(key: string): number[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function writeIds(key: string, ids: number[]) {
  try { window.localStorage.setItem(key, JSON.stringify(ids)); } catch { /* storage may be unavailable */ }
}

function isInternational(channel: Channel) {
  return Boolean(channel.country && channel.country.toLocaleLowerCase() !== 'iran' && channel.country !== 'ایران') || !channel.iran;
}

function isPersianForeign(channel: Channel) {
  const language = (channel.language || '').toLocaleLowerCase();
  return (language === 'fa' || language.startsWith('fa-') || /persian|فارسی/i.test(`${channel.name} ${channel.nameEn}`)) && isInternational(channel);
}

function isCategory(channel: Channel, terms: RegExp) {
  return terms.test(`${channel.category} ${channel.categoryEn} ${channel.name} ${channel.nameEn}`);
}

export default function LiveChannelCatalogFixed({ channels, initialQuery = '', initialCategory = 'all' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory || 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [platform, setPlatform] = useState('all');
  const [country, setCountry] = useState('all');
  const [satelliteOnly, setSatelliteOnly] = useState(false);
  const [vpnOnly, setVpnOnly] = useState(false);
  const [vipOnly, setVipOnly] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<number, Snapshot>>({});
  const [favorites, setFavorites] = useState<number[]>([]);
  const [recent, setRecent] = useState<number[]>([]);

  const queueRef = useRef<number[]>([]);
  const queuedRef = useRef(new Set<number>());
  const processedRef = useRef(new Set<number>());
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const runningRef = useRef(0);
  const aliveRef = useRef(true);
  const pumpRef = useRef<() => void>(() => undefined);
  const channelMapRef = useRef(new Map(channels.map((c) => [c.id, c])));
  const orderRef = useRef(new Map(channels.map((c, i) => [c.id, i])));

  useEffect(() => {
    setFavorites(readIds(FAVORITES_KEY));
    setRecent(readIds(RECENT_KEY));
  }, []);

  useEffect(() => {
    channelMapRef.current = new Map(channels.map((c) => [c.id, c]));
    orderRef.current = new Map(channels.map((c, i) => [c.id, i]));
  }, [channels]);

  const categories = useMemo(() => Array.from(new Map(channels.map((c) => [String(c.catId), c.category || 'بدون دسته'])).entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa')), [channels]);
  const platforms = useMemo(() => Array.from(new Set(channels.map((c) => c.platform).filter(Boolean) as string[])).sort(), [channels]);
  const countries = useMemo(() => Array.from(new Set(channels.flatMap((c) => [c.country, ...(c.sources ?? []).map((s) => s.country)]).filter(Boolean) as string[])).sort(), [channels]);

  const metadataVisible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const haystack = [channel.name, channel.nameEn, channel.category, channel.categoryEn, channel.country, channel.platform, channel.satellite].filter(Boolean).join(' ').toLocaleLowerCase();
      return (!q || haystack.includes(q)) &&
        (category === 'all' || String(channel.catId) === category) &&
        (platform === 'all' || channel.platform === platform) &&
        (country === 'all' || channel.country === country || (channel.sources ?? []).some((s) => s.country === country)) &&
        (!satelliteOnly || Boolean(channel.satellite)) &&
        (!vpnOnly || channel.vpn) &&
        (!vipOnly || channel.vip || (channel.sources ?? []).some((s) => s.vip));
    });
  }, [channels, query, category, platform, country, satelliteOnly, vpnOnly, vipOnly]);

  const visible = useMemo(() => statusFilter === 'all' ? metadataVisible : metadataVisible.filter((channel) => snapshots[channel.id]?.status === statusFilter), [metadataVisible, statusFilter, snapshots]);

  const enqueue = useCallback((id: number) => {
    if (processedRef.current.has(id) || queuedRef.current.has(id)) return;
    queuedRef.current.add(id);
    queueRef.current.push(id);
    queueRef.current.sort((a, b) => {
      const aTop = elementsRef.current.get(a)?.getBoundingClientRect().top ?? Number.MAX_SAFE_INTEGER;
      const bTop = elementsRef.current.get(b)?.getBoundingClientRect().top ?? Number.MAX_SAFE_INTEGER;
      return aTop - bTop || (orderRef.current.get(a) ?? 0) - (orderRef.current.get(b) ?? 0);
    });
    pumpRef.current();
  }, []);

  const pump = useCallback(() => {
    if (!aliveRef.current) return;
    while (runningRef.current < concurrency() && queueRef.current.length) {
      const id = queueRef.current.shift();
      if (id == null) break;
      queuedRef.current.delete(id);
      if (processedRef.current.has(id)) continue;
      const channel = channelMapRef.current.get(id);
      if (!channel) continue;
      processedRef.current.add(id);
      runningRef.current += 1;
      void (async () => {
        try {
          const cached = await getLiveThumbnail(id);
          if (!aliveRef.current) return;
          const fresh = Boolean(cached && Date.now() - cached.updatedAt < SNAPSHOT_TTL);
          if (cached?.dataUrl) setSnapshots((current) => ({ ...current, [id]: { dataUrl: cached.dataUrl, status: fresh ? (cached.status as Status) : 'loading', cachedAt: cached.updatedAt } }));
          if (fresh) return;
          const result = await capture(channel);
          const entry: LiveThumbnailEntry = { channelId: id, dataUrl: result?.dataUrl || cached?.dataUrl || null, sourceUrl: result?.sourceUrl || cached?.sourceUrl || null, status: result ? 'online' : 'offline', updatedAt: Date.now(), failures: result ? 0 : (cached?.failures || 0) + 1 };
          await setLiveThumbnail(entry);
          if (aliveRef.current) setSnapshots((current) => ({ ...current, [id]: { dataUrl: entry.dataUrl, status: entry.status, cachedAt: entry.updatedAt } }));
        } finally {
          runningRef.current -= 1;
          pumpRef.current();
        }
      })();
    }
  }, []);

  pumpRef.current = pump;

  useEffect(() => {
    aliveRef.current = true;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = Number((entry.target as HTMLElement).dataset.channelId);
        if (Number.isFinite(id)) enqueue(id);
      }
    }, { rootMargin: '700px 0px', threshold: 0.01 });
    observerRef.current = observer;
    for (const element of elementsRef.current.values()) observer.observe(element);
    const connection = (navigator as Navigator & { connection?: Connection }).connection;
    const onConnectionChange = () => pumpRef.current();
    connection?.addEventListener?.('change', onConnectionChange);
    return () => { aliveRef.current = false; observer.disconnect(); observerRef.current = null; connection?.removeEventListener?.('change', onConnectionChange); };
  }, [enqueue]);

  const registerCard = useCallback((id: number, node: HTMLElement | null) => {
    if (node) {
      node.dataset.channelId = String(id);
      elementsRef.current.set(id, node);
      observerRef.current?.observe(node);
    } else elementsRef.current.delete(id);
  }, []);

  const resetFilters = () => {
    setQuery(''); setCategory('all'); setStatusFilter('all'); setPlatform('all'); setCountry('all'); setSatelliteOnly(false); setVpnOnly(false); setVipOnly(false);
  };

  const toggleFavorite = (id: number) => {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [id, ...current].slice(0, 100);
      writeIds(FAVORITES_KEY, next);
      return next;
    });
  };

  const markRecent = (id: number) => {
    setRecent((current) => {
      const next = [id, ...current.filter((value) => value !== id)].slice(0, 30);
      writeIds(RECENT_KEY, next);
      return next;
    });
  };

  const buildRail = (key: string, title: string, subtitle: string, items: Channel[], accent = false): Rail | null => {
    const unique = Array.from(new Map(items.map((item) => [item.id, item])).values());
    return unique.length ? { key, title, subtitle, items: unique, accent } : null;
  };

  const groups = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const channel of visible) {
      const key = channel.category || 'بدون دسته';
      const list = map.get(key) || [];
      list.push(channel);
      map.set(key, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [visible]);

  const rails = useMemo(() => {
    const result: Rail[] = [];
    const add = (rail: Rail | null) => { if (rail) result.push(rail); };
    add(buildRail('live', 'در حال پخش', 'فقط شبکه‌هایی که آخرین snapshot آن‌ها زنده است', visible.filter((channel) => snapshots[channel.id]?.status === 'online'), true));
    add(buildRail('favorites', 'علاقه‌مندی‌های من', 'ذخیره‌شده روی همین دستگاه', visible.filter((channel) => favorites.includes(channel.id))));
    add(buildRail('recent', 'اخیراً تماشا شده', 'آخرین شبکه‌هایی که باز کرده‌ای', recent.map((id) => channelMapRef.current.get(id)).filter((channel): channel is Channel => Boolean(channel)).filter((channel) => visible.some((item) => item.id === channel.id))));
    add(buildRail('popular', 'شبکه‌های محبوب', 'بر اساس امتیاز محبوبیت کاتالوگ', [...visible].filter((channel) => channel.popular > 0).sort((a, b) => b.popular - a.popular)));
    add(buildRail('satellite', 'شبکه‌های ماهواره‌ای', 'شبکه‌هایی با مشخصات ماهواره‌ای', visible.filter((channel) => Boolean(channel.satellite))));
    add(buildRail('international', 'بین‌المللی', 'شبکه‌های خارج از دسته ایران', visible.filter(isInternational)));
    add(buildRail('persian-foreign', 'شبکه‌های فارسی‌زبان خارجی', 'فارسی‌زبان، اما خارج از ایران', visible.filter(isPersianForeign)));
    add(buildRail('sports', 'شبکه‌های ورزشی', 'پخش زنده و محتوای ورزشی', visible.filter((channel) => isCategory(channel, /sport|sports|ورزش|football|soccer/i))));
    add(buildRail('news', 'شبکه‌های خبری مهم', 'خبر و اطلاع‌رسانی', visible.filter((channel) => isCategory(channel, /news|خبر|اخبار/i))));
    add(buildRail('music', 'شبکه‌های موزیک ویدئو', 'موزیک، ویدئو و سرگرمی موسیقایی', visible.filter((channel) => isCategory(channel, /music|موزیک|موسیقی/i))));
    add(buildRail('movies', 'شبکه‌های فیلم و سریال', 'فیلم، سریال و سینما', visible.filter((channel) => isCategory(channel, /movie|film|فیلم|سریال|cinema|سینما/i))));
    for (const [name, items] of groups) add(buildRail(`category-${name}`, name, `${items.length} شبکه در این دسته`, items));
    return result;
  }, [visible, snapshots, favorites, recent, groups]);

  const renderCard = (channel: Channel, railKey: string) => {
    const snapshot = snapshots[channel.id];
    const status = snapshot?.status || 'loading';
    const fallback = channel.image;
    const initials = (channel.nameEn || channel.name || 'TV').trim().slice(0, 3).toUpperCase();
    const favorite = favorites.includes(channel.id);
    return <article key={`${railKey}-${channel.id}`} className={styles.card} ref={(node) => registerCard(channel.id, node)} data-channel-id={channel.id}>
      <Link href={`/channel/${channel.id}`} className={styles.cardLink} onClick={() => markRecent(channel.id)}>
        <div className={styles.thumb}>
          {snapshot?.dataUrl ? <img className={styles.image} src={snapshot.dataUrl} alt={`${channel.name} live`} loading="lazy" /> : fallback ? <img className={styles.image} src={fallback} alt={channel.name} loading="lazy" /> : <div className={styles.placeholder}>{initials}</div>}
          {!snapshot?.dataUrl ? <div className={styles.thumbSkeleton} aria-hidden="true" /> : null}
          {status === 'online' ? <span className={styles.live}>LIVE</span> : status === 'offline' ? <span className={styles.offline}>موقتاً خاموش</span> : <span className={styles.loading}>در حال بررسی…</span>}
          {snapshot?.dataUrl ? <span className={styles.cached}>LIVE SNAPSHOT</span> : null}
          {channel.vip ? <span className={styles.vip}>VIP</span> : null}
        </div>
        <div className={styles.body}><div className={styles.name}>{channel.name}</div><div className={styles.meta}>{channel.nameEn} · {(channel.sources ?? []).length} منبع</div><div className={styles.tags}>{channel.category ? <span className={styles.tag}>{channel.category}</span> : null}{channel.platform ? <span className={styles.tag}>{channel.platform}</span> : null}{channel.satellite ? <span className={styles.tag}>SAT {channel.satellite}</span> : null}</div></div>
      </Link>
      <button type="button" className={`${styles.favorite} ${favorite ? styles.favoriteActive : ''}`} onClick={() => toggleFavorite(channel.id)} aria-label={favorite ? `حذف ${channel.name} از علاقه‌مندی‌ها` : `افزودن ${channel.name} به علاقه‌مندی‌ها`} aria-pressed={favorite}>{favorite ? '★' : '☆'}</button>
    </article>;
  };

  return <section className={styles.catalog} dir="rtl">
    <div className={styles.toolbar}>
      <input className={styles.control} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی نام، دسته، کشور، ماهواره…" />
      <select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">همه دسته‌ها</option>{categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      <select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">همه وضعیت‌ها</option><option value="online">در حال پخش</option><option value="offline">موقتاً خاموش</option></select>
      <select className={styles.select} value={platform} onChange={(e) => setPlatform(e.target.value)}><option value="all">همه پلتفرم‌ها</option>{platforms.map((x) => <option key={x} value={x}>{x}</option>)}</select>
      <select className={styles.select} value={country} onChange={(e) => setCountry(e.target.value)}><option value="all">همه کشورها</option>{countries.map((x) => <option key={x} value={x}>{x}</option>)}</select>
    </div>
    <div className={styles.filterBar}>
      <button type="button" className={`${styles.chip} ${category === 'all' ? styles.chipActive : ''}`} onClick={() => setCategory('all')}>همه دسته‌ها</button>
      <button type="button" className={`${styles.chip} ${satelliteOnly ? styles.chipActive : ''}`} onClick={() => setSatelliteOnly((v) => !v)}>ماهواره‌ای</button>
      <button type="button" className={`${styles.chip} ${vpnOnly ? styles.chipActive : ''}`} onClick={() => setVpnOnly((v) => !v)}>VPN</button>
      <button type="button" className={`${styles.chip} ${vipOnly ? styles.chipActive : ''}`} onClick={() => setVipOnly((v) => !v)}>VIP</button>
      <button type="button" className={styles.chip} onClick={resetFilters}>پاک کردن فیلترها</button>
    </div>
    <div className={styles.statusBox}>لود زنده فقط نزدیک viewport انجام می‌شود؛ snapshot از cache مرورگر استفاده می‌کند و وضعیت capture ترتیب کاتالوگ را تغییر نمی‌دهد.</div>
    <div className={styles.sectionTitle}><span>کاتالوگ هوشمند</span><strong>{visible.length} شبکه</strong></div>
    <div className={styles.rails}>
      {rails.map((rail, index) => <section key={rail.key} className={`${styles.rail} ${rail.accent ? styles.railAccent : ''}`} style={{ '--rail-index': index } as React.CSSProperties}>
        <div className={styles.railHeader}><div><h2>{rail.title}</h2><p>{rail.subtitle}</p></div><span>{rail.items.length}</span></div>
        <div className={styles.railViewport}><div className={styles.railGrid}>{rail.items.map((channel) => renderCard(channel, rail.key))}</div></div>
      </section>)}
    </div>
    {!visible.length ? <div className={styles.empty}>شبکه‌ای مطابق فیلتر فعلی پیدا نشد.</div> : null}
  </section>;
}
