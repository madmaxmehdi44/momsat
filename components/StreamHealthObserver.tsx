'use client';

import { useEffect } from 'react';
import type { PersistentChannel } from './PersistentPlayerProvider';

type Props = { channel: PersistentChannel | null };

function sourceFromCurrentSrc(currentSrc: string) {
  if (!currentSrc) return '';
  try {
    const url = new URL(currentSrc, window.location.origin);
    if (url.pathname === '/api/stream') return url.searchParams.get('url')?.trim() || '';
    if (/^https?:$/i.test(url.protocol)) return url.href;
  } catch {}
  return currentSrc.startsWith('http://') || currentSrc.startsWith('https://') ? currentSrc : '';
}

function report(channelId: number, url: string, outcome: 'success' | 'failure', latencyMs: number, error?: string) {
  if (!channelId || !url) return;
  void fetch('/api/stream-health', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    body: JSON.stringify({ channelId, url, outcome, latencyMs, error }),
  }).catch(() => undefined);
}

export default function StreamHealthObserver({ channel }: Props) {
  useEffect(() => {
    if (!channel?.id) return;

    let currentUrl = '';
    let startedAt = 0;
    let failureReported = false;
    let successReported = false;
    let timer: number | null = null;

    const findVideo = () => document.querySelector('.persistent-player-host video, .player-pro-shell video, video.pro-player-video') as HTMLVideoElement | null;

    const syncCurrentSource = () => {
      const video = findVideo();
      if (!video) return null;
      const nextUrl = sourceFromCurrentSrc(video.currentSrc || video.getAttribute('src') || '');
      if (nextUrl && nextUrl !== currentUrl) {
        currentUrl = nextUrl;
        startedAt = performance.now();
        failureReported = false;
        successReported = false;
      }
      return video;
    };

    const onLoadStart = () => { syncCurrentSource(); };
    const onPlaying = () => {
      const video = syncCurrentSource();
      if (!video || !currentUrl || successReported) return;
      successReported = true;
      report(channel.id!, currentUrl, 'success', Math.max(0, Math.round(performance.now() - startedAt)));
    };
    const onError = () => {
      const video = syncCurrentSource();
      if (!video || !currentUrl || failureReported) return;
      failureReported = true;
      const mediaError = video.error;
      report(channel.id!, currentUrl, 'failure', Math.max(0, Math.round(performance.now() - startedAt)), mediaError ? `MediaError ${mediaError.code}` : 'HTMLMediaElement error');
    };

    const attach = () => {
      const video = findVideo();
      if (!video) return;
      video.addEventListener('loadstart', onLoadStart);
      video.addEventListener('playing', onPlaying);
      video.addEventListener('error', onError);
      syncCurrentSource();
    };

    attach();
    timer = window.setInterval(() => {
      const video = findVideo();
      if (!video) return;
      if (video.currentSrc) syncCurrentSource();
    }, 750);

    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (timer != null) window.clearInterval(timer);
      observer.disconnect();
      const video = findVideo();
      video?.removeEventListener('loadstart', onLoadStart);
      video?.removeEventListener('playing', onPlaying);
      video?.removeEventListener('error', onError);
    };
  }, [channel?.id]);

  return null;
}
