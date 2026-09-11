'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePersistentPlayer, type PersistentChannel } from './PersistentPlayerProvider';
import { clientCacheGet, clientCacheSet } from '../lib/client-cache';
import styles from './SmartPlayer.module.css';

type Source = { url: string; title?: string | null; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = PersistentChannel;
type ResolvedSource = Source & { discoveredFrom?: string; depth?: number };
type ProbeResult = { ok?: boolean; playable?: boolean; latencyMs?: number };

function isDirectMedia(url: string) { return /\.(?:m3u8|mp4|webm|m4v)(?:$|[?#])/i.test(url); }
function databaseCandidates(channel: Channel) {
  const raw = [...(channel.url ? [{ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin }] : []), ...(channel.sources ?? [])].filter((source) => /^https?:\/\//i.test(source.url.trim()));
  return Array.from(new Map(raw.map((source) => [source.url.trim(), source])).values());
}

async function resolvePages(sources: Source[]) {
  const queue = sources.slice(0, 8);
  const groups = await Promise.all(queue.map(async (source) => {
    try {
      const params = new URLSearchParams({ url: source.url });
      if (source.referer) params.set('referer', source.referer);
      if (source.origin) params.set('origin', source.origin);
      const url = `/api/stream/resolve?${params.toString()}`;
      const cached = await clientCacheGet<{ sources?: ResolvedSource[] }>(url, 60_000);
      if (cached?.sources) return cached.sources;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return [] as ResolvedSource[];
      const body = await response.json() as { sources?: ResolvedSource[] };
      void clientCacheSet(url, body);
      return body.sources ?? [];
    } catch { return [] as ResolvedSource[]; }
  }));
  return Array.from(new Map(groups.flat().map((source) => [source.url.trim(), source])).values());
}

async function probeSource(source: Source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);
  try {
    const params = new URLSearchParams({ url: source.url });
    if (source.referer) params.set('referer', source.referer);
    if (source.origin) params.set('origin', source.origin);
    const url = `/api/stream/probe?${params.toString()}`;
    const cached = await clientCacheGet<ProbeResult>(url, 15_000);
    if (cached && (cached.playable || cached.ok)) return cached;
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const result = await response.json() as ProbeResult;
    if (result.playable || result.ok) void clientCacheSet(url, result);
    return result.playable || result.ok ? result : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function verifySources(sources: Source[]) {
  const candidates = sources.slice(0, 12);
  const results = await Promise.all(candidates.map(async (source, index) => {
    const probe = await probeSource(source);
    return probe ? { source, index, latencyMs: probe.latencyMs ?? Number.MAX_SAFE_INTEGER } : null;
  }));
  return results.filter((item): item is { source: Source; index: number; latencyMs: number } => Boolean(item)).sort((a, b) => Number(isDirectMedia(b.source.url)) - Number(isDirectMedia(a.source.url)) || a.latencyMs - b.latencyMs || a.index - b.index).map((item) => item.source);
}

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const { setActiveChannel } = usePersistentPlayer();
  const candidates = useMemo(() => databaseCandidates(channel), [channel.id, channel.url, channel.referer, channel.origin, channel.sources]);
  const directCandidates = useMemo(() => candidates.filter((source) => isDirectMedia(source.url)), [candidates]);
  const pageCandidates = useMemo(() => candidates.filter((source) => !isDirectMedia(source.url)), [candidates]);
  const [resolved, setResolved] = useState<ResolvedSource[]>([]);
  const [verified, setVerified] = useState<Source[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setResolved([]); setVerified([]); setResolutionError('');
    if (!pageCandidates.length) { setResolving(false); return () => { cancelled = true; }; }
    setResolving(true);
    void resolvePages(pageCandidates).then((discovered) => {
      if (cancelled) return;
      setResolved(discovered); setResolving(false);
      if (!discovered.length && !directCandidates.length) setResolutionError('هیچ مسیر مستقیم قابل پخش از منابع دیتابیس پیدا نشد.');
    }).catch(() => { if (!cancelled) { setResolving(false); if (!directCandidates.length) setResolutionError('استخراج منبع پخش ناموفق بود.'); } });
    return () => { cancelled = true; };
  }, [directCandidates.length, pageCandidates]);

  const allSources = useMemo(() => Array.from(new Map([...directCandidates, ...resolved].map((source) => [source.url.trim(), source])).values()), [directCandidates, resolved]);
  useEffect(() => {
    let cancelled = false;
    if (!allSources.length) { setVerified([]); return () => { cancelled = true; }; }
    void verifySources(allSources).then((playableSources) => { if (!cancelled) setVerified(playableSources); }).catch(() => { if (!cancelled) setVerified([]); });
    return () => { cancelled = true; };
  }, [allSources]);

  useEffect(() => {
    if (!allSources.length) return;
    const orderedSources = [...verified, ...allSources.filter((source) => !verified.some((item) => item.url === source.url))];
    const primary = orderedSources[0];
    if (!primary) return;
    const posterImage = channel.image ? `/api/channel-thumbnail?url=${encodeURIComponent(channel.image)}&name=${encodeURIComponent(channel.name || 'TV')}` : null;
    setActiveChannel({
      ...channel,
      image: posterImage,
      url: primary.url,
      referer: primary.referer,
      origin: primary.origin,
      sources: orderedSources,
    });
  }, [allSources, verified, channel, setActiveChannel]);

  if (allSources.length > 0) {
    return <div className={styles.persistentNotice}>پلیر هوشمند در پایین صفحه فعال است و با جابه‌جایی بین صفحات قطع نمی‌شود.</div>;
  }
  if (resolving) return <div className={styles.embedPlayer}><div className={styles.probing}>در حال استخراج مسیر پخش از دیتابیس…</div></div>;
  return <div className={styles.embedPlayer}><div className={styles.probing}>{resolutionError || 'برای این شبکه مسیر پخش در دیتابیس ثبت نشده است.'}</div></div>;
}
