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
  const results = await Promise.all(sources.map(async (source, index) => {
    try {
      const params = new URLSearchParams({ url: source.url });
      if (source.referer) params.set('referer', source.referer);
      if (source.origin) params.set('origin', source.origin);
      const response = await fetch(`/api/stream/probe?${params.toString()}`);
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
    setResolved([]);
    setResolutionError('');

    if (!directCandidates.length) {
      setSelected(null);
      setProbing(false);
      return () => { cancelled = true; };
    }

    setProbing(true);
    setSelected(null);

    void probeSources(directCandidates).then((playable) => {
      if (cancelled) return;
      setSelected(playable[0] ?? null);
      setProbing(false);
    });

    return () => { cancelled = true; };
  }, [directCandidates]);

  useEffect(() => {
    let cancelled = false;
    if (directCandidates.length > 0 || pageCandidates.length === 0) {
      setResolving(false);
      return () => { cancelled = true; };
    }

    setResolving(true);
    setResolutionError('');

    const queue = pageCandidates.slice(0, 4);
    void Promise.all(queue.map(async (source) => {
      try {
        const params = new URLSearchParams({ url: source.url });
        const response = await fetch(`/api/stream/resolve?${params.toString()}`);
        if (!response.ok) return [] as ResolvedSource[];
        const body = await response.json() as { sources?: ResolvedSource[] };
        return body.sources ?? [];
      } catch {
        return [] as ResolvedSource[];
      }
    })).then(async (groups) => {
      if (cancelled) return;
      const discovered = Array.from(new Map(groups.flat().map((source) => [source.url, source])).values());
      const playable = await probeSources(discovered);
      if (cancelled) return;
      if (playable.length) {
        setResolved(playable);
        setSelected(playable[0]);
      } else {
        setResolutionError('از صفحه‌ی منبع، مسیر مستقیم قابل پخش پیدا نشد.');
      }
      setResolving(false);
    }).catch(() => {
      if (cancelled) return;
      setResolutionError('استخراج منبع پخش ناموفق بود.');
      setResolving(false);
    });

    return () => { cancelled = true; };
  }, [directCandidates.length, pageCandidates]);

  if (directCandidates.length > 0) {
    if (probing) {
      return <div className={styles.embedPlayer}><div className={styles.probing}>در حال بررسی مسیرهای پخش زنده…</div></div>;
    }

    if (selected) {
      const remaining = directCandidates.filter((source) => source.url !== selected.url);
      return <PlayerV2 channel={{ ...channel, url: selected.url, referer: selected.referer, origin: selected.origin, sources: [selected, ...remaining] }} />;
    }

    return <PlayerV2 channel={{ ...channel, sources: directCandidates }} />;
  }

  if (resolving) {
    return <div className={styles.embedPlayer}><div className={styles.probing}>در حال استخراج منبع واقعی پخش از سرویس‌دهنده…</div></div>;
  }

  if (selected || resolved.length > 0) {
    const sources = selected ? [selected, ...resolved.filter((source) => source.url !== selected.url)] : resolved;
    return <PlayerV2 channel={{ ...channel, url: sources[0].url, referer: sources[0].referer, origin: sources[0].origin, sources }} />;
  }

  return (
    <div className={styles.embedPlayer}>
      <div className={styles.probing}>
        {resolutionError || 'برای این شبکه مسیر مستقیم قابل پخش پیدا نشد.'}
      </div>
    </div>
  );
}
