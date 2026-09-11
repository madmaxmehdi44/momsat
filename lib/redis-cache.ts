import crypto from 'node:crypto';
import { ttlGetOrSet } from './ttl-cache';

type RedisCommandResponse = { result?: string | null; error?: string };

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function keyDigest(key: string) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function redisKey(key: string) {
  return `momsat:${keyDigest(key)}`;
}

async function command(command: unknown[]) {
  if (!REDIS_URL || !REDIS_TOKEN) return null;
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${REDIS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Redis HTTP ${response.status}`);
  const body = await response.json() as RedisCommandResponse;
  if (body.error) throw new Error(body.error);
  return body.result ?? null;
}

export function redisConfigured() {
  return Boolean(REDIS_URL && REDIS_TOKEN);
}

export async function redisGet<T>(key: string): Promise<T | undefined> {
  try {
    const result = await command(['GET', redisKey(key)]);
    if (!result) return undefined;
    return JSON.parse(result) as T;
  } catch {
    return undefined;
  }
}

export async function redisSet<T>(key: string, value: T, ttlMs: number) {
  try {
    await command(['SET', redisKey(key), JSON.stringify(value), 'PX', Math.max(1000, Math.floor(ttlMs))]);
  } catch {
    // Redis is an acceleration layer; the local fallback remains authoritative.
  }
  return value;
}

export async function redisGetOrSet<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const redisValue = await redisGet<T>(key);
  if (redisValue !== undefined) return redisValue;

  const value = await ttlGetOrSet(`redis-fallback:${key}`, ttlMs, loader);
  if (redisConfigured()) void redisSet(key, value, ttlMs);
  return value;
}
