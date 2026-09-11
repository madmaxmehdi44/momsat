'use client';

const CACHE_NAME = 'momsat-stream-cache-v1';
const DEFAULT_MAX_AGE_MS = 60_000;

function canUseCache() {
  return typeof window !== 'undefined' && 'caches' in window;
}

function cacheKey(url: string) {
  return new Request(`${window.location.origin}/__momsat_cache__?key=${encodeURIComponent(url)}`);
}

export async function clientCacheGet<T>(url: string, maxAgeMs = DEFAULT_MAX_AGE_MS): Promise<T | null> {
  if (!canUseCache()) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(cacheKey(url));
    if (!response) return null;
    const storedAt = Number(response.headers.get('x-momsat-stored-at') || 0);
    if (!storedAt || Date.now() - storedAt > maxAgeMs) {
      await cache.delete(cacheKey(url));
      return null;
    }
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function clientCacheSet<T>(url: string, value: T) {
  if (!canUseCache()) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'x-momsat-stored-at': String(Date.now()) },
    });
    await cache.put(cacheKey(url), response);
  } catch {}
}

export async function clientCacheClear() {
  if (!canUseCache()) return;
  try { await caches.delete(CACHE_NAME); } catch {}
}
