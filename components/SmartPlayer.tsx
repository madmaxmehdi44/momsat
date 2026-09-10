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

function isDirectMedia(url: string) {
  return /\.(?:m3u8|mp4|webm|m4v)(?:$|\?)/i.test(url) || /(?:\/|[?&])(m3u8|playlist|manifest|stream)(?:[/?=&]|$)/i.test(url);
}

function isEmbeddablePage(url: string) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol);
  } catch {
    return false;
  }
}

function uniqueCandidates(channel: Channel) {
  const candidates = [
    ...(channel.url ? [{ url: channel.url, referer: channel.referer, origin: channel.origin }] : []),
    ...(channel.sources ?? []),
    ...(getClientStreamFallback(channel.name)?.sources ?? []),
  ].filter((source) => /^https?:\/\//i.test(source.url));
  return Array.from(new Map(candidates.map((source) => [source.url.trim(), source])).values());
}

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const candidates = useMemo(() => uniqueCandidates(channel), [channel]);
  const directCandidates = useMemo(() => candidates.filter((source) => isDirectMedia(source.url)), [candidates]);
  const pageCandidates = useMemo(() => candidates.filter((source) => !isDirectMedia(source.url) && isEmbeddablePage(source.url)), [candidates]);
  const [selected, setSelected] = useState<Source | null>(null);
  const [probing, setProbing] = useState(directCandidates.length > 0);

  useEffect(() => {
    let cancelled = false;
    if (!directCandidates.length) {
      setSelected(null);
      setProbing(false);
      return () => { cancelled = true; };
    }

    setProbing(true);
    setSelected(null);

    void Promise.all(
      directCandidates.map(async (source, index) => {
        try {
          const params = new URLSearchParams({ url: source.url });
          if (source.referer) params.set('referer', source.referer);
          if (source.origin) params.set('origin', source.origin);
          const response = await fetch(`/api/stream/probe?${params.toString()}`, { cache: 'no-store' });
          const probe = response.ok ? (await response.json() as Probe) : null;
          return { source, probe, index };
        } catch {
          return { source, probe: null, index };
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const playable = results
        .filter((item) => item.probe?.playable)
        .sort((a, b) => (a.probe?.latencyMs ?? Number.MAX_SAFE_INTEGER) - (b.probe?.latencyMs ?? Number.MAX_SAFE_INTEGER) || a.index - b.index);
      setSelected(playable[0]?.source ?? null);
      setProbing(false);
    });

    return () => { cancelled = true; };
  }, [directCandidates]);

  if (directCandidates.length > 0) {
    if (probing) {
      return <div className={styles.embedPlayer}><div className={styles.probing}>در حال بررسی مسیرهای پخش زنده…</div></div>;
    }

    if (selected) {
      const remaining = directCandidates.filter((source) => source.url !== selected.url);
      return <PlayerV2 channel={{ ...channel, url: selected.url, referer: selected.referer, origin: selected.origin, sources: [selected, ...remaining] }} />;
    }

    if (!pageCandidates.length) return <PlayerV2 channel={{ ...channel, sources: directCandidates }} />;
  }

  const embed = pageCandidates[0];
  if (!embed) return <PlayerV2 channel={channel} />;

  return (
    <div className={styles.embedPlayer}>
      <iframe
        title={channel.name || 'MOMSAT live player'}
        src={embed.url}
        loading="eager"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className={styles.badge}>External player</div>
    </div>
  );
}
