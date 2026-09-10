'use client';

import { useEffect, useMemo, useState } from 'react';
import PlayerDirectFirst from './PlayerDirectFirst';
import styles from './SmartPlayer.module.css';

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

type ResolvedSource = Source & {
  discoveredFrom?: string;
  depth?: number;
};

type ProbeResult = {
  ok?: boolean;
  playable?: boolean;
  latencyMs?: number;
};

function isDirectMedia(url: string) {
  return /\.(?:m3u8|mp4|webm|m4v)(?:$|[?#])/i.test(url);
}

function databaseCandidates(channel: Channel) {
  const raw = [
    ...(channel.url ? [{ url: channel.url, title: 'Primary', referer: channel.referer, origin: channel.origin }] : []),
    ...(channel.sources ?? []),
  ].filter((source) => /^https?:\/\//i.test(source.url.trim()));
  return Array.from(new Map(raw.map((source) => [source.url.trim(), source])).values());
}

async function resolvePages(sources: Source[]) {
  const queue = sources.slice(0, 8);
  const groups = await Promise.all(queue.map(async (source) => {
    try {
      const params = new URLSearchParams({ url: source.url });
      if (source.referer) params.set('referer', source.referer);
      if (source.origin) params.set('origin', source.origin);
      const response = await fetch(`/api/stream/resolve?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) return [] as ResolvedSource[];
      const body = await response.json() as { sources?: ResolvedSource[] };
      return body.sources ?? [];
    } catch {
      return [] as ResolvedSource[];
    }
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
    const response = await fetch(`/api/stream/probe?${params.toString()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) return null;
    const result = await response.json() as ProbeResult;
    return result.playable || result.ok ? result : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifySources(sources: Source[]) {
  const candidates = sources.slice(0, 12);
  const results = await Promise.all(candidates.map(async (source, index) => {
    const probe = await probeSource(source);
    return probe ? { source, index, latencyMs: probe.latencyMs ?? Number.MAX_SAFE_INTEGER } : null;
  }));

  return results
    .filter((item): item is { source: Source; index: number; latencyMs: number } => Boolean(item))
    .sort((a, b) => {
      const mediaScore = Number(isDirectMedia(b.source.url)) - Number(isDirectMedia(a.source.url));
      if (mediaScore !== 0) return mediaScore;
      return a.latencyMs - b.latencyMs || a.index - b.index;
    })
    .map((item) => item.source);
}

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const candidates = useMemo(() => databaseCandidates(channel), [channel.url, channel.referer, channel.origin, channel.sources]);
  const directCandidates = useMemo(() => candidates.filter((source) => isDirectMedia(source.url)), [candidates]);
  const pageCandidates = useMemo(() => candidates.filter((source) => !isDirectMedia(source.url)), [candidates]);
  const [resolved, setResolved] = useState<ResolvedSource[]>([]);
  const [verified, setVerified] = useState<Source[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setResolved([]);
    setVerified([]);
    setResolutionError('');

    if (!pageCandidates.length) {
      setResolving(false);
      return () => { cancelled = true; };
    }

    setResolving(true);
    void resolvePages(pageCandidates).then((discovered) => {
      if (cancelled) return;
      setResolved(discovered);
      setResolving(false);
      if (!discovered.length && !directCandidates.length) {
        setResolutionError('هیچ مسیر مستقیم قابل پخش از منابع دیتابیس پیدا نشد.');
      }
    }).catch(() => {
      if (cancelled) return;
      setResolving(false);
      if (!directCandidates.length) setResolutionError('استخراج منبع پخش ناموفق بود.');
    });

    return () => { cancelled = true; };
  }, [directCandidates.length, pageCandidates]);

  const allSources = useMemo(() => {
    const sources = [...directCandidates, ...resolved];
    return Array.from(new Map(sources.map((source) => [source.url.trim(), source])).values());
  }, [directCandidates, resolved]);

  useEffect(() => {
    let cancelled = false;
    if (!allSources.length) {
      setVerified([]);
      return () => { cancelled = true; };
    }

    // Probing is advisory. The player must still receive every candidate so its runtime failover can try sources a probe could not classify.
    void verifySources(allSources).then((playableSources) => {
      if (cancelled) return;
      setVerified(playableSources);
    }).catch(() => {
      if (cancelled) setVerified([]);
    });

    return () => { cancelled = true; };
  }, [allSources]);

  const posterImage = channel.image
    ? `/api/channel-thumbnail?url=${encodeURIComponent(channel.image)}&name=${encodeURIComponent(channel.name || 'TV')}`
    : null;

  if (allSources.length > 0) {
    const orderedSources = [
      ...verified,
      ...allSources.filter((source) => !verified.some((item) => item.url === source.url)),
    ];
    const primary = orderedSources[0];
    return <PlayerDirectFirst channel={{ ...channel, image: posterImage, url: primary.url, referer: primary.referer, origin: primary.origin, sources: orderedSources }} />;
  }

  if (resolving) {
    return <div className={styles.embedPlayer}><div className={styles.probing}>در حال استخراج مسیر پخش از دیتابیس…</div></div>;
  }

  return (
    <div className={styles.embedPlayer}>
      <div className={styles.probing}>{resolutionError || 'برای این شبکه مسیر پخش در دیتابیس ثبت نشده است.'}</div>
    </div>
  );
}
