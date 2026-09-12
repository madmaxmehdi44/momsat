'use client';

import { useEffect } from 'react';
import type { PersistentChannel } from './PersistentPlayerProvider';

type Props = { channel: PersistentChannel | null };

const FAILURE_GRACE_MS = 8000;
const FREEZE_RECOVERY_MS = 4500;
const FREEZE_FAILURE_MS = 12000;
const PROGRESS_POLL_MS = 1000;

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

    let attachedVideo: HTMLVideoElement | null = null;
    let currentUrl = '';
    let startedAt = 0;
    let lastCurrentTime = -1;
    let lastProgressAt = 0;
    let recoveryAttempted = false;
    let failureReported = false;
    let successReported = false;
    let timer: number | null = null;
    let failureTimer: number | null = null;
    let freezeTimer: number | null = null;

    const findVideo = () => document.querySelector('.persistent-player-host video, .player-pro-shell video, video.pro-player-video') as HTMLVideoElement | null;

    const clearFailureTimer = () => {
      if (failureTimer != null) {
        window.clearTimeout(failureTimer);
        failureTimer = null;
      }
    };
    const clearFreezeTimer = () => {
      if (freezeTimer != null) {
        window.clearTimeout(freezeTimer);
        freezeTimer = null;
      }
    };

    const syncCurrentSource = () => {
      const video = findVideo();
      if (!video) return null;
      const nextUrl = sourceFromCurrentSrc(video.currentSrc || video.getAttribute('src') || '');
      if (nextUrl && nextUrl !== currentUrl) {
        clearFailureTimer(); clearFreezeTimer();
        currentUrl = nextUrl;
        startedAt = performance.now();
        lastCurrentTime = video.currentTime;
        lastProgressAt = performance.now();
        recoveryAttempted = false; failureReported = false; successReported = false;
      }
      return video;
    };

    const softRecover = (video: HTMLVideoElement) => {
      if (recoveryAttempted || video.paused || video.ended || !currentUrl) return;
      recoveryAttempted = true;
      try { video.load(); void video.play().catch(() => undefined); } catch {}
    };

    const onLoadStart = () => { clearFailureTimer(); clearFreezeTimer(); syncCurrentSource(); };
    const onProgress = () => {
      const video = syncCurrentSource(); if (!video) return;
      if (video.currentTime !== lastCurrentTime) {
        lastCurrentTime = video.currentTime; lastProgressAt = performance.now(); recoveryAttempted = false; clearFreezeTimer();
      }
    };
    const onPlaying = () => {
      const video = syncCurrentSource(); if (!video || !currentUrl) return;
      clearFailureTimer(); clearFreezeTimer(); lastCurrentTime = video.currentTime; lastProgressAt = performance.now(); recoveryAttempted = false;
      if (successReported && !failureReported) return;
      failureReported = false;
      successReported = true;
      report(channel.id!, currentUrl, 'success', Math.max(0, Math.round(performance.now() - startedAt)));
    };
    const scheduleFreezeCheck = () => {
      clearFreezeTimer();
      freezeTimer = window.setTimeout(() => {
        freezeTimer = null;
        const video = syncCurrentSource();
        if (!video || video.paused || video.ended || failureReported || !currentUrl) return;
        const now = performance.now();
        const frozen = now - lastProgressAt >= FREEZE_RECOVERY_MS && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!frozen) return;
        softRecover(video);
        const elapsed = now - lastProgressAt;
        if (elapsed >= FREEZE_FAILURE_MS) {
          failureReported = true;
          successReported = false;
          report(channel.id!, currentUrl, 'failure', Math.max(0, Math.round(now - startedAt)), 'Live playback frozen after recovery attempt');
          return;
        }
        scheduleFreezeCheck();
      }, FREEZE_RECOVERY_MS);
    };
    const onWaiting = () => {
      const video = syncCurrentSource(); if (!video || video.paused || video.ended || failureReported) return;
      scheduleFreezeCheck();
    };
    const onError = () => {
      const video = syncCurrentSource(); if (!video || !currentUrl || failureReported) return;
      clearFailureTimer();
      failureTimer = window.setTimeout(() => {
        failureTimer = null;
        const latest = syncCurrentSource(); if (!latest || failureReported || !currentUrl) return;
        const stillBroken = latest.error != null && latest.paused && latest.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
        if (!stillBroken) return;
        softRecover(latest);
        failureTimer = window.setTimeout(() => {
          failureTimer = null;
          const recovered = syncCurrentSource(); if (!recovered || failureReported || !currentUrl) return;
          const stillBrokenAfterRecovery = recovered.error != null && recovered.paused && recovered.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
          if (!stillBrokenAfterRecovery) return;
          failureReported = true;
          successReported = false;
          const mediaError = recovered.error;
          report(channel.id!, currentUrl, 'failure', Math.max(0, Math.round(performance.now() - startedAt)), mediaError ? `MediaError ${mediaError.code} after recovery` : 'HTMLMediaElement error after recovery grace');
        }, FREEZE_RECOVERY_MS);
      }, FAILURE_GRACE_MS);
    };

    const detach = (video: HTMLVideoElement | null) => {
      if (!video) return;
      video.removeEventListener('loadstart', onLoadStart); video.removeEventListener('playing', onPlaying); video.removeEventListener('timeupdate', onProgress); video.removeEventListener('progress', onProgress); video.removeEventListener('canplay', onProgress); video.removeEventListener('waiting', onWaiting); video.removeEventListener('stalled', onWaiting); video.removeEventListener('error', onError);
      if (attachedVideo === video) attachedVideo = null;
    };
    const attach = () => {
      const video = findVideo();
      if (!video || video === attachedVideo) return;
      detach(attachedVideo); attachedVideo = video;
      video.addEventListener('loadstart', onLoadStart); video.addEventListener('playing', onPlaying); video.addEventListener('timeupdate', onProgress); video.addEventListener('progress', onProgress); video.addEventListener('canplay', onProgress); video.addEventListener('waiting', onWaiting); video.addEventListener('stalled', onWaiting); video.addEventListener('error', onError); syncCurrentSource();
    };

    attach();
    timer = window.setInterval(() => {
      attach(); const video = attachedVideo; if (!video) return;
      if (video.currentSrc) syncCurrentSource();
      if (video.paused || video.ended || failureReported || !currentUrl) return;
      if (video.currentTime !== lastCurrentTime) { lastCurrentTime = video.currentTime; lastProgressAt = performance.now(); recoveryAttempted = false; clearFreezeTimer(); return; }
      if (performance.now() - lastProgressAt >= FREEZE_RECOVERY_MS) scheduleFreezeCheck();
    }, PROGRESS_POLL_MS);

    const observer = new MutationObserver(() => attach());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { if (timer != null) window.clearInterval(timer); clearFailureTimer(); clearFreezeTimer(); observer.disconnect(); detach(attachedVideo); };
  }, [channel?.id]);
  return null;
}
