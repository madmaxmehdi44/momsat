'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import type { Channel } from '../lib/source';
import { getLiveThumbnail, setLiveThumbnail, type LiveThumbnailEntry } from '../lib/live-thumbnail-cache';
import styles from './LiveChannelCatalog.module.css';

type Props = { channels: Channel[]; initialQuery?: string; initialCategory?: string };
type UiStatus = 'online' | 'offline' | 'loading';
type Snapshot = { dataUrl: string | null; status: UiStatus; cachedAt?: number };
type CaptureCandidate = { id: number | null; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean };
type NavigatorConnection = { effectiveType?: string; downlink?: number; saveData?: boolean; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };

const CAPTURE_TIMEOUT_MS = 6000;
const CACHE_FRESH_MS = 120_000;
const MAX_CANDIDATES = 4;

function captureConcurrency() {
  if (typeof navigator === 'undefined') return 2;
  const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
  if (connection?.saveData) return 1;
  if ((connection?.downlink ?? 10) < 1 || /2g/i.test(connection?.effectiveType || '')) return 1;
  if ((connection?.downlink ?? 10) < 3 || /3g/i.test(connection?.effectiveType || '')) return 2;
  return 3;
}

function mediaUrl(channel: Channel, source: CaptureCandidate) {
  const raw = source.url || channel.url;
  if (!raw) return null;
  if (/^\/api\/stream\?/i.test(raw)) return raw;
  const params = new URLSearchParams({ url: raw });
  const referer = source.referer || channel.referer;
  const origin = source.origin || channel.origin;
  if (referer) params.set('referer', referer);
  if (origin) params.set('origin', origin);
  return `/api/stream?${params.toString()}`;
}

function sourceCandidates(channel: Channel): CaptureCandidate[] {
  const primary: CaptureCandidate = { id: null, title: null, url: channel.url, referer: channel.referer, origin: channel.origin, country: channel.country, vip: channel.vip };
  const sources: CaptureCandidate[] = (channel.sources || []).map((source) => ({ id: source.id, title: source.title, url: source.url, referer: source.referer, origin: source.origin, country: source.country, vip: source.vip }));
  return Array.from(new Map([primary, ...sources].filter((item) => Boolean(item.url)).map((item) => [item.url.trim(), item])).values());
}

async function captureSnapshot(channel: Channel): Promise<{ dataUrl: string; sourceUrl: string } | null> {
  for (const candidate of sourceCandidates(channel).slice(0, MAX_CANDIDATES)) {
    const url = mediaUrl(channel, candidate);
    if (!url) continue;
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.crossOrigin = 'anonymous';
    video.style.cssText = 'position:fixed;width:2px;height:2px;left:-10000px;top:-10000px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    let destroyHls: (() => void) | null = null;
    try {
      const loaded = await new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (value: boolean) => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(value); };
        const timer = window.setTimeout(() => finish(false), CAPTURE_TIMEOUT_MS);
        video.addEventListener('loadeddata', () => finish(true), { once: true });
        video.addEventListener('canplay', () => finish(true), { once: true });
        video.addEventListener('error', () => finish(false), { once: true });
        if (/\.m3u8(?:$|[?#])/i.test(url)) {
          if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 6, maxBufferLength: 6, maxMaxBufferLength: 10, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, manifestLoadingTimeOut: 3500, levelLoadingTimeOut: 3500, fragLoadingTimeOut: 4000 });
            destroyHls = () => hls.destroy();
            hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) finish(false); });
            hls.loadSource(url); hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
          else finish(false);
        } else video.src = url;
        void video.play().catch(() => undefined);
      });
      if (!loaded || !video.videoWidth || !video.videoHeight) continue;
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = Math.max(270, Math.round(480 * video.videoHeight / video.videoWidth));
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length < 1000) continue;
      return { dataUrl, sourceUrl: url };
    } catch {
      // Try the next source.
    } finally {
      try { if (destroyHls) destroyHls(); } catch {}
      video.pause(); video.removeAttribute('src'); video.load(); video.remove();
    }
  }
  return null;
}

export default function LiveChannelCatalogFinal({ channels, initialQuery = '', initialCategory = 'all' }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory || 'all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [satelliteOnly, setSatelliteOnly] = useState(false);
  const [vpnOnly, setVpnOnly] = useState(false);
  const [vipOnly, setVipOnly] = useState(false);
  const [snapshots, setSnapshots] = useState<Record<number, Snapshot>>({});

  const queueRef = useRef<number[]>([]);
  const queuedRef = useRef(new Set<number>());
  const processedRef = useRef(new Set<number>());
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const runningRef = useRef(0);
  const aliveRef = useRef(true);
  const pumpRef = useRef<() => void>(() => undefined);
  const orderRef = useRef(new Map(channels.map((channel, index) => [channel.id, index])));

  const categories = useMemo(() => Array.from(new Map(channels.map((c) => [String(c.catId), c.category || 'بدون دسته'])).entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa')), [channels]);
  const platforms = useMemo(() => Array.from(new Set(channels.map((c) => c.platform).filter(Boolean) as string[])).sort(), [channels]);
  const countries = useMemo(() => Array.from(new Set(channels.flatMap((c) => [c.country, ...c.sources.map((s) => s.country)]).filter(Boolean) as string[])).sort(), [channels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const haystack = [channel.name, channel.nameEn, channel.category, channel.categoryEn, channel.satellite, channel.country, channel.platform].filter(Boolean).join(' ').toLocaleLowerCase();
      const status = snapshots[channel.id]?.status;
      const statusMatches = statusFilter === 'all' ? true : statusFilter === 'offline' ? status === 'offline' : status !== 'offline';
      return (!q || haystack.includes(q)) && (category === 'all' || String(channel.catId) === category) && statusMatches && (platformFilter === 'all' || channel.platform === platformFilter) && (countryFilter === 'all' || channel.country === countryFilter || channel.sources.some((s) => s.country === countryFilter)) && (!satelliteOnly || Boolean(channel.satellite)) && (!vpnOnly || channel.vpn) && (!vipOnly || channel.vip || channel.sources.some((s) => s.vip));
    });
  }, [channels, query, category, statusFilter, platformFilter, countryFilter, satelliteOnly, vpnOnly, vipOnly, snapshots]);

  const enqueue = useCallback((channelId: number) => {
    if (processedRef.current.has(channelId) || queuedRef.current.has(channelId)) return;
    queuedRef.current.add(channelId);
    queueRef.current.push(channelId);
    queueRef.current.sort((a, b) => {
      const ta = elementsRef.current.get(a)?.getBoundingClientRect().top ?? Number.MAX_SAFE_INTEGER;
      const tb = elementsRef.current.get(b)?.getBoundingClientRect().top ?? Number.MAX_SAFE_INTEGER;
      return ta - tb || (orderRef.current.get(a) ?? 0) - (orderRef.current.get(b) ?? 0);
    });
    pumpRef.current();
  }, []);

  const pump = useCallback(() => {
    if (!aliveRef.current) return;
    const limit = captureConcurrency();
    while (runningRef.current < limit && queueRef.current.length) {
      const channelId = queueRef.current.shift()!;
      queuedRef.current.delete(channelId);
      if (processedRef.current.has(channelId)) continue;
      const channel = channels.find((item) => item.id === channelId);
      if (!channel) continue;
      processedRef.current.add(channelId);
      runningRef.current += 1;
      void (async () => {
        try {
          const cached = await getLiveThumbnail(channel.id);
          if (!aliveRef.current) return;
          if (cached?.dataUrl) {
            setSnapshots((current) => ({ ...current, [channel.id]: { dataUrl: cached.dataUrl, status: Date.now() - cached.updatedAt < CACHE_FRESH_MS ? (cached.status as UiStatus) : 'loading', cachedAt: cached.updatedAt } }));
          }
          if (cached && Date.now() - cached.updatedAt < CACHE_FRESH_MS) return;
          const result = await captureSnapshot(channel);
          const entry: LiveThumbnailEntry = { channelId: channel.id, dataUrl: result?.dataUrl || cached?.dataUrl || null, sourceUrl: result?.sourceUrl || cached?.sourceUrl || null, status: result ? 'online' : 'offline', updatedAt: Date.now(), failures: result ? 0 : (cached?.failures || 0) + 1 };
          await setLiveThumbnail(entry);
          if (aliveRef.current) setSnapshots((current) => ({ ...current, [channel.id]: { dataUrl: entry.dataUrl, status: entry.status, cachedAt: entry.updatedAt } }));
        } finally {
          runningRef.current -= 1;
          pumpRef.current();
        }
      })();
    }
  }, [channels]);

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
    for (const [id, element] of elementsRef.current) observer.observe(element);
    const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
    const rerun = () => pumpRef.current();
    connection?.addEventListener?.('change', rerun);
    return () => { aliveRef.current = false; observer.disconnect(); observerRef.current = null; connection?.removeEventListener?.('change', rerun); };
  }, [enqueue]);

  const resetFilters = () => {
    setQuery(''); setCategory('all'); setStatusFilter('all'); setPlatformFilter('all'); setCountryFilter('all'); setSatelliteOnly(false); setVpnOnly(false); setVipOnly(false);
  };

  const statusFor = (channel: Channel): UiStatus => snapshots[channel.id]?.status || 'loading';
  const mainItems = filtered.filter((channel) => statusFor(channel) !== 'offline');
  const offlineItems = filtered.filter((channel) => statusFor(channel) === 'offline');

  const renderChannel = (channel: Channel) => {
    const snapshot = snapshots[channel.id];
    const status = statusFor(channel);
    const initials = (channel.nameEn || channel.name || 'TV').trim().slice(0, 3).toUpperCase();
    return <Link href={`/channel/${channel.id}`} className={styles.card} key={channel.id} data-channel-id={channel.id} ref={(node) => { if (node) { elementsRef.current.set(channel.id, node); observerRef.current?.observe(node); } else elementsRef.current.delete(channel.id); }}>
      <div className={styles.thumb}>
        {snapshot?.dataUrl ? <img className={styles.image} src={snapshot.dataUrl} alt={`${channel.name} live`} /> : channel.image ? <img className={styles.image} src={channel.image} alt={channel.name} /> : <div className={styles.placeholder}>{initials}</div>}
        {status === 'online' ? <span className={styles.live}>LIVE</span> : status === 'offline' ? <span className={styles.offline}>موقتاً خاموش</span> : <span className={styles.loading}>در حال بررسی…</span>}
        {snapshot?.dataUrl ? <span className={styles.cached}>LIVE SNAPSHOT</span> : null}
      </div>
      <div className={styles.body}><div className={styles.name}>{channel.name}</div><div className={styles.meta}>{channel.nameEn} · {channel.sources.length} منبع</div><div className={styles.tags}>{channel.category ? <span className={styles.tag}>{channel.category}</span> : null}{channel.platform ? <span className={styles.tag}>{channel.platform}</span> : null}{channel.satellite ? <span className={styles.tag}>SAT {channel.satellite}</span> : null}</div></div>
    </Link>;
  };

  return <section className={styles.catalog} dir="rtl">
    <div className={styles.toolbar}>
      <input className={styles.control} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="جستجوی نام، دسته، کشور، ماهواره…" />
      <select className={styles.select} value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">همه دسته‌ها</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select className={styles.select} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">همه وضعیت‌ها</option><option value="online">در حال پخش / در حال بررسی</option><option value="offline">موقتاً خاموش</option></select>
      <select className={styles.select} value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="all">همه پلتفرم‌ها</option>{platforms.map((item) => <option key={item} value={item}>{item}</option>)}</select>
      <select className={styles.select} value={countryFilter} onChange={(event) => setCountryFilter(event.target.value)}><option value="all">همه کشورها</option>{countries.map((item) => <option key={item} value={item}>{item}</option>)}</select>
    </div>
    <div className={styles.filterBar}>
      <button type="button" className={`${styles.chip} ${category === 'all' ? styles.chipActive : ''}`} onClick={() => setCategory('all')}>همه</button>
      {categories.map((item) => <button type="button" className={`${styles.chip} ${category === item.id ? styles.chipActive : ''}`} key={item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}
      <button type="button" className={styles.chip} onClick={resetFilters}>پاک کردن فیلترها</button>
    </div>
    <div className={styles.advanced}>
      <label className={styles.check}><input type="checkbox" checked={satelliteOnly} onChange={(event) => setSatelliteOnly(event.target.checked)} /> ماهواره‌ای</label>
      <label className={styles.check}><input type="checkbox" checked={vpnOnly} onChange={(event) => setVpnOnly(event.target.checked)} /> نیازمند VPN</label>
      <label className={styles.check}><input type="checkbox" checked={vipOnly} onChange={(event) => setVipOnly(event.target.checked)} /> VIP</label>
      <span className={styles.stat}>نمایش {filtered.length} از {channels.length}</span>
      <span className={styles.stat}>در لیست اصلی {mainItems.length}</span>
      <span className={styles.stat}>موقتاً خاموش {offlineItems.length}</span>
    </div>
    <div className={styles.stats}><span className={styles.mutedBox}>ترتیب کارت‌ها ثابت است. capture فقط برای کارت‌های نزدیک viewport انجام می‌شود؛ Snapshot کش‌شده فوراً نمایش داده می‌شود و تغییر فیلتر صف capture را از صفر شروع نمی‌کند.</span></div>
    {mainItems.length ? <section className={styles.section}><div className={styles.sectionTitle}><h2>شبکه‌ها</h2><span>{mainItems.length} شبکه · ترتیب اصلی کاتالوگ</span></div><div className={styles.grid}>{mainItems.map(renderChannel)}</div></section> : null}
    {offlineItems.length ? <section className={styles.section}><div className={styles.sectionTitle}><h2>شبکه‌های موقتاً خاموش</h2><span>{offlineItems.length} شبکه · capture ناموفق</span></div><div className={styles.grid}>{offlineItems.map(renderChannel)}</div></section> : null}
    {!mainItems.length && !offlineItems.length ? <div className={styles.empty}>شبکه‌ای با فیلترهای فعلی پیدا نشد.</div> : null}
  </section>;
}
