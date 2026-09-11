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
type NavigatorConnection = { effectiveType?: string; downlink?: number; saveData?: boolean; addEventListener?: (type: string, listener: () => void) => void; removeEventListener?: (type: string, listener: () => void) => void };

const CAPTURE_TIMEOUT_MS = 9000;

function captureConcurrency() {
  if (typeof navigator === 'undefined') return 2;
  const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
  if (connection?.saveData) return 1;
  if ((connection?.downlink ?? 10) < 1 || /2g/i.test(connection?.effectiveType || '')) return 1;
  if ((connection?.downlink ?? 10) < 3 || /3g/i.test(connection?.effectiveType || '')) return 2;
  return 3;
}

function mediaUrl(channel: Channel, source: Channel['sources'][number] | null) {
  const raw = source?.url || channel.url;
  if (!raw) return null;
  if (/^\/api\/stream\?/i.test(raw)) return raw;
  const params = new URLSearchParams({ url: raw });
  const referer = source?.referer || channel.referer;
  const origin = source?.origin || channel.origin;
  if (referer) params.set('referer', referer);
  if (origin) params.set('origin', origin);
  return `/api/stream?${params.toString()}`;
}

function sourceCandidates(channel: Channel) {
  const raw = [{ url: channel.url, referer: channel.referer, origin: channel.origin }, ...(channel.sources || [])];
  return Array.from(new Map(raw.filter((item) => Boolean(item.url)).map((item) => [item.url.trim(), item])).values());
}

async function captureSnapshot(channel: Channel): Promise<{ dataUrl: string; sourceUrl: string } | null> {
  for (const candidate of sourceCandidates(channel).slice(0, 6)) {
    const url = mediaUrl(channel, candidate);
    if (!url) continue;
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto';
    video.style.cssText = 'position:fixed;width:2px;height:2px;left:-10000px;top:-10000px;opacity:0;pointer-events:none;';
    document.body.appendChild(video);
    let hls: Hls | null = null;
    try {
      const loaded = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = window.setTimeout(() => finish(false), CAPTURE_TIMEOUT_MS);
        const finish = (value: boolean) => { if (settled) return; settled = true; window.clearTimeout(timer); resolve(value); };
        video.addEventListener('loadeddata', () => finish(true), { once: true });
        video.addEventListener('canplay', () => finish(true), { once: true });
        video.addEventListener('error', () => finish(false), { once: true });
        if (/\.m3u8(?:$|[?#])/i.test(url)) {
          if (Hls.isSupported()) {
            hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 8, maxBufferLength: 7, maxMaxBufferLength: 12, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 1, manifestLoadingTimeOut: 4500, levelLoadingTimeOut: 4500, fragLoadingTimeOut: 5000 });
            hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) finish(false); });
            hls.loadSource(url); hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
          else finish(false);
        } else video.src = url;
        void video.play().catch(() => undefined);
      });
      if (!loaded || !video.videoWidth || !video.videoHeight) continue;
      await new Promise((resolve) => window.setTimeout(resolve, 180));
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = Math.max(270, Math.round(480 * video.videoHeight / video.videoWidth));
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
      if (dataUrl.length < 1000) continue;
      return { dataUrl, sourceUrl: url };
    } catch {
      // Try another source.
    } finally {
      try { hls?.destroy(); } catch {}
      video.pause(); video.removeAttribute('src'); video.load(); video.remove();
    }
  }
  return null;
}

export default function LiveChannelCatalogV2({ channels, initialQuery = '', initialCategory = 'all' }: Props) {
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
  const observedRef = useRef(new Set<number>());
  const elementsRef = useRef(new Map<number, HTMLElement>());
  const runningRef = useRef(0);
  const aliveRef = useRef(true);
  const pumpRef = useRef<() => void>(() => undefined);

  const categories = useMemo(() => Array.from(new Map(channels.map((c) => [String(c.catId), c.category || 'بدون دسته'])).entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa')), [channels]);
  const platforms = useMemo(() => Array.from(new Set(channels.map((c) => c.platform).filter(Boolean) as string[])).sort(), [channels]);
  const countries = useMemo(() => Array.from(new Set(channels.flatMap((c) => [c.country, ...c.sources.map((s) => s.country)]).filter(Boolean) as string[])).sort(), [channels]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return channels.filter((channel) => {
      const haystack = [channel.name, channel.nameEn, channel.category, channel.categoryEn, channel.satellite, channel.country, channel.platform].filter(Boolean).join(' ').toLocaleLowerCase();
      const status = snapshots[channel.id]?.status;
      return (!q || haystack.includes(q)) && (category === 'all' || String(channel.catId) === category) && (statusFilter === 'all' || status === statusFilter) && (platformFilter === 'all' || channel.platform === platformFilter) && (countryFilter === 'all' || channel.country === countryFilter || channel.sources.some((s) => s.country === countryFilter)) && (!satelliteOnly || Boolean(channel.satellite)) && (!vpnOnly || channel.vpn) && (!vipOnly || channel.vip || channel.sources.some((s) => s.vip));
    });
  }, [channels, query, category, statusFilter, platformFilter, countryFilter, satelliteOnly, vpnOnly, vipOnly, snapshots]);

  const schedule = useCallback((channelId: number) => {
    if (observedRef.current.has(channelId) || queuedRef.current.has(channelId)) return;
    queuedRef.current.add(channelId); queueRef.current.push(channelId); pumpRef.current();
  }, []);

  const pump = useCallback(() => {
    if (!aliveRef.current) return;
    const limit = captureConcurrency();
    while (runningRef.current < limit && queueRef.current.length) {
      const id = queueRef.current.shift()!;
      queuedRef.current.delete(id);
      const channel = channels.find((item) => item.id === id);
      if (!channel) continue;
      runningRef.current += 1;
      void (async () => {
        const cached = await getLiveThumbnail(channel.id);
        if (aliveRef.current && cached) setSnapshots((current) => ({ ...current, [channel.id]: { dataUrl: cached.dataUrl, status: 'loading', cachedAt: cached.updatedAt } }));
        if (aliveRef.current) setSnapshots((current) => ({ ...current, [channel.id]: { dataUrl: current[channel.id]?.dataUrl || cached?.dataUrl || null, status: 'loading', cachedAt: cached?.updatedAt } }));
        const result = await captureSnapshot(channel);
        const entry: LiveThumbnailEntry = { channelId: channel.id, dataUrl: result?.dataUrl || cached?.dataUrl || null, sourceUrl: result?.sourceUrl || cached?.sourceUrl || null, status: result ? 'online' : 'offline', updatedAt: Date.now(), failures: result ? 0 : (cached?.failures || 0) + 1 };
        await setLiveThumbnail(entry);
        if (aliveRef.current) setSnapshots((current) => ({ ...current, [channel.id]: { dataUrl: entry.dataUrl, status: entry.status, cachedAt: entry.updatedAt } }));
        runningRef.current -= 1;
        pumpRef.current();
      })();
    }
  }, [channels]);

  pumpRef.current = pump;

  useEffect(() => {
    aliveRef.current = true;
    observedRef.current.clear(); queuedRef.current.clear(); queueRef.current = [];
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) if (entry.isIntersecting) {
        const id = Number((entry.target as HTMLElement).dataset.channelId);
        if (Number.isFinite(id)) { observedRef.current.add(id); queueRef.current.push(id); queuedRef.current.add(id); }
      }
      pumpRef.current();
    }, { rootMargin: '520px 0px', threshold: 0.01 });
    for (const [id, element] of elementsRef.current) if (filtered.some((channel) => channel.id === id)) observer.observe(element);
    const connection = (navigator as Navigator & { connection?: NavigatorConnection }).connection;
    const rerun = () => pumpRef.current();
    connection?.addEventListener?.('change', rerun);
    return () => { aliveRef.current = false; observer.disconnect(); connection?.removeEventListener?.('change', rerun); };
  }, [filtered, pump]);

  const grouped = useMemo(() => ({
    online: filtered.filter((c) => snapshots[c.id]?.status === 'online'),
    loading: filtered.filter((c) => snapshots[c.id]?.status === 'loading' || !snapshots[c.id]),
    offline: filtered.filter((c) => snapshots[c.id]?.status === 'offline'),
  }), [filtered, snapshots]);

  const renderChannel = (channel: Channel) => {
    const snap = snapshots[channel.id];
    const status = snap?.status || 'loading';
    const initials = (channel.nameEn || channel.name || 'TV').trim().slice(0, 3).toUpperCase();
    return <Link href={`/channel/${channel.id}`} className={styles.card} key={channel.id} data-channel-id={channel.id} ref={(node) => { if (node) { elementsRef.current.set(channel.id, node); if (!observedRef.current.has(channel.id)) queueMicrotask(() => { if (node.isConnected) pumpRef.current(); }); } else elementsRef.current.delete(channel.id); }}>
      <div className={styles.thumb}>{snap?.dataUrl ? <img className={styles.image} src={snap.dataUrl} alt={`${channel.name} live`} /> : <div className={styles.placeholder}>{initials}</div>}{status === 'online' ? <span className={styles.live}>LIVE</span> : status === 'offline' ? <span className={styles.offline}>موقتاً خاموش</span> : <span className={styles.loading}>در حال گرفتن تصویر…</span>}{snap?.dataUrl ? <span className={styles.cached}>LIVE SNAPSHOT</span> : null}</div>
      <div className={styles.body}><div className={styles.name}>{channel.name}</div><div className={styles.meta}>{channel.nameEn} · {channel.sources.length} منبع</div><div className={styles.tags}>{channel.category ? <span className={styles.tag}>{channel.category}</span> : null}{channel.platform ? <span className={styles.tag}>{channel.platform}</span> : null}{channel.satellite ? <span className={styles.tag}>SAT {channel.satellite}</span> : null}</div></div>
    </Link>;
  };

  const section = (title: string, items: Channel[], hint: string) => items.length ? <section className={styles.section}><div className={styles.sectionTitle}><h2>{title}</h2><span>{hint} · {items.length}</span></div><div className={styles.grid}>{items.map(renderChannel)}</div></section> : null;

  return <section className={styles.catalog} dir="rtl">
    <div className={styles.toolbar}><input className={styles.control} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="جستجوی کامل نام، زبان، دسته، ماهواره…" /><select className={styles.select} value={category} onChange={(e) => setCategory(e.target.value)}><option value="all">همه دسته‌ها</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={styles.select} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="all">همه وضعیت‌ها</option><option value="online">در حال پخش</option><option value="offline">موقتاً خاموش</option></select><select className={styles.select} value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)}><option value="all">همه پلتفرم‌ها</option>{platforms.map((item) => <option key={item} value={item}>{item}</option>)}</select><select className={styles.select} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)}><option value="all">همه کشورها</option>{countries.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
    <div className={styles.filterBar}><button className={`${styles.chip} ${category === 'all' ? styles.chipActive : ''}`} onClick={() => setCategory('all')}>همه</button>{categories.map((item) => <button className={`${styles.chip} ${category === item.id ? styles.chipActive : ''}`} key={item.id} onClick={() => setCategory(item.id)}>{item.name}</button>)}</div>
    <div className={styles.advanced}><label className={styles.check}><input type="checkbox" checked={satelliteOnly} onChange={(e) => setSatelliteOnly(e.target.checked)} /> ماهواره‌ای</label><label className={styles.check}><input type="checkbox" checked={vpnOnly} onChange={(e) => setVpnOnly(e.target.checked)} /> نیازمند VPN</label><label className={styles.check}><input type="checkbox" checked={vipOnly} onChange={(e) => setVipOnly(e.target.checked)} /> VIP</label><span className={styles.stat}>نمایش {filtered.length} از {channels.length}</span><span className={styles.stat}>آنلاین {grouped.online.length}</span><span className={styles.stat}>در حال بررسی {grouped.loading.length}</span><span className={styles.stat}>موقتاً خاموش {grouped.offline.length}</span></div>
    <div className={styles.stats}><span className={styles.mutedBox}>Snapshot قبلی فوراً از cache همین مرورگر نمایش داده می‌شود، اما کارت‌های قابل‌مشاهده در هر بار ورود دوباره capture می‌شوند. تعداد capture هم با سرعت اتصال و Data Saver تنظیم می‌شود.</span></div>
    {section('شبکه‌های در حال پخش', grouped.online, 'snapshot معتبر')}{section('شبکه‌های در حال بارگذاری', grouped.loading, 'صف capture')}{section('شبکه‌های موقتاً خاموش', grouped.offline, 'capture ناموفق')}
    {!grouped.online.length && !grouped.loading.length && !grouped.offline.length ? <div className={styles.empty}>شبکه‌ای با فیلترهای فعلی پیدا نشد.</div> : null}
  </section>;
}
