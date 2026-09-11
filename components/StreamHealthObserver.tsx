'use client';

import { useEffect } from 'react';
import type { PersistentChannel } from './PersistentPlayerProvider';

type Props = { channel: PersistentChannel | null };

const FAILURE_GRACE_MS = 8000;

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
    let failureTimer: number | null = null;

    const findVideo = () => document.querySelector('.persistent-player-host video, .player-pro-shell video, video.pro-player-video') as HTMLVideoElement | null;

    const clearFailureTimer = () => {
      if (failureTimer != null) {
        window.clearTimeout(failureTimer);
        failureTimer = null;
      }
    };

    const syncCurrentSource = () => {
      const video = findVideo();
      if (!video) return null;
      const nextUrl = sourceFromCurrentSrc(video.currentSrc || video.getAttribute('src') || '');
      if (nextUrl && nextUrl !== currentUrl) {
        clearFailureTimer();
        currentUrl = nextUrl;
        startedAt = performance.now();
        failureReported = false;
        successReported = false;
      }
      return video;
    };

    const onLoadStart = () => {
      clearFailureTimer();
      syncCurrentSource();
    };

    const onPlaying = () => {
      const video = syncCurrentSource();
      if (!video || !currentUrl) return;
      clearFailureTimer();
      if (successReported) return;
      successReported = true;
      report(channel.id!, currentUrl, 'success', Math.max(0, Math.round(performance.now() - startedAt)));
    };

    const onError = () => {
      const video = syncCurrentSource();
      if (!video || !currentUrl || failureReported || successReported) return;
      clearFailureTimer();
      failureTimer = window.setTimeout(() => {
        failureTimer = null;
        const latest = syncCurrentSource();
        if (!latest || successReported || failureReported || !currentUrl) return;

        const stillBroken = latest.error != null
          && latest.paused
          && latest.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!stillBroken) return;

        failureReported = true;
        const mediaError = latest.error;
        report(
          channel.id!,
          currentUrl,
          'failure',
          Math.max(0, Math.round(performance.now() - startedAt)),
          mediaError ? `MediaError ${mediaError.code}` : 'HTMLMediaElement error after recovery grace',
        );
      }, FAILURE_GRACE_MS);
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
      clearFailureTimer();
      observer.disconnect();
      const video = findVideo();
      video?.removeEventListener('loadstart', onLoadStart);
      video?.removeEventListener('playing', onPlaying);
      video?.removeEventListener('error', onError);
    };
  }, [channel?.id]);

  return null;
}
