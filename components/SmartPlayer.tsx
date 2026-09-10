'use client';

import PlayerV2 from './PlayerV2';
import styles from './SmartPlayer.module.css';

type Source = {
  url: string;
  title?: string | null;
  referer?: string | null;
  origin?: string | null;
};

type Channel = {
  name?: string;
  image?: string | null;
  url?: string | null;
  referer?: string | null;
  origin?: string | null;
  sources?: Source[];
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

export default function SmartPlayer({ channel }: { channel: Channel }) {
  const candidates = [
    ...(channel.url ? [{ url: channel.url, referer: channel.referer, origin: channel.origin }] : []),
    ...(channel.sources ?? []),
  ].filter((source) => /^https?:\/\//i.test(source.url));

  const direct = candidates.find((source) => isDirectMedia(source.url));
  if (direct) {
    return <PlayerV2 channel={{ ...channel, url: direct.url, referer: direct.referer, origin: direct.origin, sources: candidates }} />;
  }

  const embed = candidates.find((source) => isEmbeddablePage(source.url));
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
