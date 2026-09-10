'use client';

import { useEffect, useMemo, useState } from 'react';
import PlayerV2 from './PlayerV2';
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
      const response = await fetch(`/api/stream/resolve?${params.toString()}`);
      if (!response.ok) return [] as ResolvedSource[];
      const body = await response.json() as { sources?: ResolvedSource[] };
      return body.sources ?? [];
    } catch {
      return [] as ResolvedSource[];
    }
  }));
  return Array.from(new Map(groups.flat().map((source) => [source.url.trim(), source])).values());
}

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const candidates = useMemo(() => databaseCandidates(channel), [channel.url, channel.referer, channel.origin, channel.sources]);
  const directCandidates = useMemo(() => candidates.filter((source) => isDirectMedia(source.url)), [candidates]);
  const pageCandidates = useMemo(() => candidates.filter((source) => !isDirectMedia(source.url)), [candidates]);
  const [resolved, setResolved] = useState<ResolvedSource[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolutionError, setResolutionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setResolved([]);
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

  const posterImage = channel.image
    ? `/api/channel-thumbnail?url=${encodeURIComponent(channel.image)}&name=${encodeURIComponent(channel.name || 'TV')}`
    : null;

  if (directCandidates.length > 0) {
    const primary = directCandidates[0];
    return <PlayerV2 channel={{ ...channel, image: posterImage, url: primary.url, referer: primary.referer, origin: primary.origin, sources: allSources }} />;
  }

  if (resolving) {
    return <div className={styles.embedPlayer}><div className={styles.probing}>در حال استخراج مسیر پخش از دیتابیس…</div></div>;
  }

  if (resolved.length > 0) {
    return <PlayerV2 channel={{ ...channel, image: posterImage, url: resolved[0].url, referer: resolved[0].referer, origin: resolved[0].origin, sources: resolved }} />;
  }

  return (
    <div className={styles.embedPlayer}>
      <div className={styles.probing}>{resolutionError || 'برای این شبکه مسیر پخش در دیتابیس ثبت نشده است.'}</div>
    </div>
  );
}
