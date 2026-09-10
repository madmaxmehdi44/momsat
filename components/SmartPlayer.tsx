'use client';

import { useEffect, useMemo, useState } from 'react';
import PlayerV2 from './PlayerV2';
import styles from './SmartPlayer.module.css';
import { getClientStreamFallback } from '../lib/client-stream-fallbacks';

type Source = {
  url: string;
  title?: string | null;
  referer?: string | null;
  origin?: string | null;
  country?: string | null;
  vip?: boolean;
};

type Channel = {
  name?: string;
  image?: string | null;
  url?: string | null;
  referer?: string | null;
  origin?: string | null;
  sources?: Source[];
};

type Probe = {
  playable?: boolean;
  kind?: 'hls' | 'media' | 'html' | 'unknown';
  latencyMs?: number;
};

type ResolvedSource = Source & {
  discoveredFrom?: string;
  depth?: number;
};

function isDirectMedia(url: string) {
  return /\.(?:m3u8|mp4|webm|m4v)(?:$|[?#])/i.test(url)
    || /(?:\/|[?&])(m3u8|playlist|manifest|stream)(?:[/?=&]|$)/i.test(url);
}

function uniqueCandidates(channel: Channel) {
  const candidates = [
    ...(channel.url ? [{ url: channel.url, referer: channel.referer, origin: channel.origin }] : []),
    ...(channel.sources ?? []),
    ...(getClientStreamFallback(channel.name)?.sources ?? []),
  ].filter((source) => /^https?:\/\//i.test(source.url));
  return Array.from(new Map(candidates.map((source) => [source.url.trim(), source])).values());
}

async function probeSources(sources: Source[]) {
  if (!sources.length) return [] as Source[];
  const results = await Promise.all(sources.map(async (source, index) => {
    try {
      const params = new URLSearchParams({ url: source.url });
      if (source.referer) params.set('referer', source.referer);
      if (source.origin) params.set('origin', source.origin);
      const response = await fetch(`/api/stream/probe?${params.toString()}`, { cache: 'force-cache' });
      const probe = response.ok ? await response.json() as Probe : null;
      return { source, probe, index };
    } catch {
      return { source, probe: null, index };
    }
  }));

  return results
    .filter((item) => item.probe?.playable)
    .sort((a, b) => (a.probe?.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.probe?.latencyMs ?? Number.MAX_SAFE_INTEGER) || a.index - b.index)
    .map((item) => item.source);
}

async function resolvePages(sources: Source[]) {
  const queue = sources.slice(0, 6);
  const groups = await Promise.all(queue.map(async (source) => {
    try {
      const params = new URLSearchParams({ url: source.url });
      const response = await fetch(`/api/stream/resolve?${params.toString()}`, { cache: 'force-cache' });
      if (!response.ok) return [] as ResolvedSource[];
      const body = await response.json() as { sources?: ResolvedSource[] };
      return body.sources ?? [];
    } catch {
      return [] as ResolvedSource[];
    }
  }));
  return Array.from(new Map(groups.flat().map((source) => [source.url, source])).values());
}

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const candidates = useMemo(() => uniqueCandidates(channel), [channel]);
  const directCandidates = useMemo(() => candidates.filter((source) => isDirectMedia(source.url)), [candidates]);
  const pageCandidates = useMemo(() => candidates.filter((source) => !isDirectMedia(source.url)), [candidates]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [resolved, setResolved] = useState<ResolvedSource[]>([]);
  const [probing, setProbing] = useState(directCandidates.length > 0);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setSelected(null);
    setResolved([]);
    setResolutionError('');
    if (!directCandidates.length) {
      setProbing(false);
      return () => { cancelled = true; };
    }

    setProbing(true);
    void probeSources(directCandidates).then((playable) => {
      if (cancelled) return;
      if (playable.length) {
        setSelected(playable[0]);
        setProbing(false);
        return;
      }
      setProbing(false);
    });

    return () => { cancelled = true; };
  }, [directCandidates]);

  useEffect(() => {
    let cancelled = false;
    if (!pageCandidates.length) {
      setResolving(false);
      return () => { cancelled = true; };
    }
    if (selected || directCandidates.length > 0 && probing) {
      setResolving(false);
      return () => { cancelled = true; };
    }

    setResolving(true);
    void resolvePages(pageCandidates).then(async (discovered) => {
      if (cancelled) return;
      if (!discovered.length) {
        setResolving(false);
        setResolutionError('هیچ مسیر مستقیم قابل پخش از صفحهٔ شبکه پیدا نشد.');
        return;
      }
      const playable = await probeSources(discovered);
      if (cancelled) return;
      if (playable.length) {
        setResolved(playable as ResolvedSource[]);
        setSelected(playable[0]);
      } else {
        setResolutionError('منبع استخراج شد، اما هیچ مسیر پخش زنده‌ای پاسخ قابل پخش نداد.');
      }
      setResolving(false);
    }).catch(() => {
      if (cancelled) return;
      setResolutionError('استخراج منبع پخش ناموفق بود.');
      setResolving(false);
    });

    return () => { cancelled = true; };
  }, [directCandidates.length, pageCandidates, probing, selected]);

  if (probing) {
    return <div className={styles.embedPlayer}><div className={styles.probing}>در حال پیدا کردن سریع‌ترین مسیر پخش…</div></div>;
  }

  if (selected) {
    const all = selected.url
      ? [selected, ...directCandidates, ...resolved].filter((source, index, list) => list.findIndex((item) => item.url === source.url) === index)
      : [...directCandidates, ...resolved];
    return <PlayerV2 channel={{ ...channel, url: selected.url, referer: selected.referer, origin: selected.origin, sources: all }} />;
  }

  if (directCandidates.length > 0 && !pageCandidates.length) {
    return <PlayerV2 channel={{ ...channel, sources: directCandidates }} />;
  }

  if (resolving) {
    return <div className={styles.embedPlayer}><div className={styles.probing}>در حال استخراج مسیر واقعی پخش از سرویس‌دهنده…</div></div>;
  }

  if (resolved.length > 0) {
    return <PlayerV2 channel={{ ...channel, url: resolved[0].url, referer: resolved[0].referer, origin: resolved[0].origin, sources: resolved }} />;
  }

  return (
    <div className={styles.embedPlayer}>
      <div className={styles.probing}>{resolutionError || 'برای این شبکه مسیر قابل پخش پیدا نشد.'}</div>
    </div>
  );
}
