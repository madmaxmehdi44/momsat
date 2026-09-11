'use client';

type QueuedRequest<T> = {
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const STREAM_IDLE_GRACE_MS = 12_000;
const APP_REQUEST_GAP_MS = 180;
const APP_REQUEST_GAP_WHILE_STREAMING_MS = 850;
const MAX_APP_CONCURRENCY = 2;
const MAX_APP_CONCURRENCY_WHILE_STREAMING = 1;

let streamRequests = 0;
let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
let lastStreamTrafficAt = 0;
let activeAppRequests = 0;
let lastAppRequestAt = 0;
const appQueue: Array<QueuedRequest<unknown>> = [];

function normalizeUrl(input: string) {
  try {
    return new URL(input, typeof window !== 'undefined' ? window.location.href : 'http://localhost').toString();
  } catch {
    return input;
  }
}

export function isStreamTrafficUrl(input: string) {
  const url = normalizeUrl(input).toLowerCase();
  if (url.includes('/api/stream')) return true;
  if (/\.m3u8(?:$|[?#])/.test(url)) return true;
  if (/\.(?:ts|m4s|mp2t|aac|ac3)(?:$|[?#])/.test(url)) return true;
  return false;
}

export function noteStreamRequestStart(url: string) {
  if (!isStreamTrafficUrl(url)) return;
  streamRequests += 1;
  lastStreamTrafficAt = Date.now();
  if (streamIdleTimer) clearTimeout(streamIdleTimer);
  streamIdleTimer = null;
  pumpAppQueue();
}

export function noteStreamRequestEnd(url: string) {
  if (!isStreamTrafficUrl(url)) return;
  streamRequests = Math.max(0, streamRequests - 1);
  lastStreamTrafficAt = Date.now();
  scheduleStreamIdleReset();
  pumpAppQueue();
}

export function isStreamingActive() {
  return streamRequests > 0 || Date.now() - lastStreamTrafficAt < STREAM_IDLE_GRACE_MS;
}

export function getNetworkPolicy() {
  return {
    streaming: isStreamingActive(),
    streamRequests,
    maxAppConcurrency: isStreamingActive() ? MAX_APP_CONCURRENCY_WHILE_STREAMING : MAX_APP_CONCURRENCY,
    requestGapMs: isStreamingActive() ? APP_REQUEST_GAP_WHILE_STREAMING_MS : APP_REQUEST_GAP_MS,
  };
}

function scheduleStreamIdleReset() {
  if (streamIdleTimer) clearTimeout(streamIdleTimer);
  if (streamRequests > 0) return;
  const remaining = Math.max(1, STREAM_IDLE_GRACE_MS - (Date.now() - lastStreamTrafficAt));
  streamIdleTimer = setTimeout(() => {
    streamIdleTimer = null;
    if (streamRequests === 0) pumpAppQueue();
  }, remaining);
}

function pumpAppQueue() {
  if (typeof window === 'undefined') return;
  const policy = getNetworkPolicy();
  while (appQueue.length > 0 && activeAppRequests < policy.maxAppConcurrency) {
    const now = Date.now();
    const elapsed = now - lastAppRequestAt;
    if (elapsed < policy.requestGapMs) {
      setTimeout(pumpAppQueue, policy.requestGapMs - elapsed);
      return;
    }

    const item = appQueue.shift();
    if (!item) return;
    activeAppRequests += 1;
    lastAppRequestAt = Date.now();

    item.task().then(item.resolve, item.reject).finally(() => {
      activeAppRequests = Math.max(0, activeAppRequests - 1);
      pumpAppQueue();
    });
  }
}

export function scheduleAppNetworkRequest<T>(task: () => Promise<T>, options: { highPriority?: boolean } = {}) {
  if (options.highPriority || typeof window === 'undefined') return task();

  return new Promise<T>((resolve, reject) => {
    appQueue.push({
      task,
      resolve: resolve as (value: unknown | PromiseLike<unknown>) => void,
      reject,
    });
    pumpAppQueue();
  });
}

export function setRequestPriority(
  init: RequestInit | undefined,
  priority: 'high' | 'low' | 'auto',
) {
  const next = { ...(init || {}) } as RequestInit & { priority?: 'high' | 'low' | 'auto' };
  if (!next.priority) next.priority = priority;
  return next;
}
