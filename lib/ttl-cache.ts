type Entry<T> = {
  value: T;
  expiresAt: number;
};

const cache = new Map<string, Entry<unknown>>();
const MAX_ENTRIES = 1000;

function prune(now = Date.now()) {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
}

export function ttlGet<T>(key: string): T | undefined {
  const entry = cache.get(key) as Entry<T> | undefined;
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

export function ttlSet<T>(key: string, value: T, ttlMs: number): T {
  const now = Date.now();
  prune(now);
  cache.delete(key);
  cache.set(key, { value, expiresAt: now + Math.max(0, ttlMs) });
  return value;
}

export async function ttlGetOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = ttlGet<T>(key);
  if (cached !== undefined) return cached;

  const pendingKey = `${key}:pending`;
  const pending = ttlGet<Promise<T>>(pendingKey);
  if (pending) return pending;

  const promise = loader().then((value) => {
    ttlSet(key, value, ttlMs);
    cache.delete(pendingKey);
    return value;
  }).catch((error) => {
    cache.delete(pendingKey);
    throw error;
  });

  ttlSet(pendingKey, promise, Math.max(ttlMs, 10_000));
  return promise;
}
