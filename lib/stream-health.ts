import type { StreamHealthStatus as PrismaStreamHealthStatus } from '@prisma/client';
import type { Channel } from './source';
import { withDbReadTimeout, withDbTimeout } from './db-timeout';

export type StreamHealthStatus = PrismaStreamHealthStatus;

type HealthRecord = {
  channelId: number;
  url: string;
  status: StreamHealthStatus;
  successCount: number;
  failureCount: number;
  failureStreak: number;
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  lastLatencyMs: number | null;
  averageLatencyMs: number | null;
  lastError: string | null;
  disabledAt: Date | null;
  disabledReason: string | null;
};

const BROKEN_STREAK = 3;
const MAX_ERROR_LENGTH = 500;
const CHANNEL_EXISTS_TTL_MS = 5 * 60_000;
const CHANNEL_MISSING_TTL_MS = 30_000;
const SOURCE_EXISTS_TTL_MS = 2 * 60_000;
const SOURCE_MISSING_TTL_MS = 15_000;
const SOURCE_CACHE_MAX_ENTRIES = 10_000;
const HEALTH_RECENCY_WINDOW_MS = 6 * 60 * 60_000;
const channelExistenceCache = new Map<number, { exists: boolean; expiresAt: number }>();
const sourceRegistrationCache = new Map<string, { exists: boolean; expiresAt: number }>();

function normalizeUrl(url: string) { return url.trim(); }
function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error ?? 'Unknown stream error');
  return value.trim().slice(0, MAX_ERROR_LENGTH);
}
function now() { return new Date(); }
function recencyPenalty(lastFailureAt: Date | null) {
  if (!lastFailureAt) return 0;
  const age = Math.max(0, Date.now() - lastFailureAt.getTime());
  if (age >= HEALTH_RECENCY_WINDOW_MS) return 0;
  return 18 * (1 - age / HEALTH_RECENCY_WINDOW_MS);
}

export function streamHealthScore(record: HealthRecord | undefined) {
  if (!record) return 45;
  if (record.status === 'ARCHIVED') return -1000;
  if (record.status === 'BROKEN') return -900;
  const total = Math.max(0, record.successCount + record.failureCount);
  const successRate = total > 0 ? record.successCount / total : 0.5;
  const reliabilityScore = successRate * 42;
  const experienceScore = Math.min(18, Math.log10(record.successCount + 1) * 9);
  const latency = record.averageLatencyMs ?? record.lastLatencyMs;
  const latencyScore = latency == null ? 8 : Math.max(0, 20 - Math.min(20, latency / 100));
  const recentFailurePenalty = recencyPenalty(record.lastFailureAt);
  const streakPenalty = Math.min(22, record.failureStreak * 6);
  if (record.status === 'SUSPECT') return Math.max(0, 18 + reliabilityScore * 0.55 + latencyScore * 0.5 - recentFailurePenalty - streakPenalty);
  return 38 + reliabilityScore + experienceScore + latencyScore - recentFailurePenalty - streakPenalty;
}

export async function getStreamHealthForChannels(channelIds: number[]) {
  if (!process.env.DATABASE_URL?.trim() || !channelIds.length) return new Map<string, HealthRecord>();
  try {
    const rows = await withDbReadTimeout((tx) => tx.streamHealth.findMany({ where: { channelId: { in: channelIds } } }));
    return new Map(rows.map((row) => [`${row.channelId}|${normalizeUrl(row.url)}`, row as HealthRecord]));
  } catch (error) {
    console.warn('[stream-health] Failed to load health records.', error);
    return new Map<string, HealthRecord>();
  }
}

export async function applyStreamHealth(channels: Channel[]) {
  if (!channels.length || !process.env.DATABASE_URL?.trim()) return channels;
  const health = await getStreamHealthForChannels(channels.map((channel) => channel.id));
  return channels.map((channel) => {
    const sources = (channel.sources ?? [])
      .filter((source) => {
        const record = health.get(`${channel.id}|${normalizeUrl(source.url)}`);
        return record?.status !== 'BROKEN' && record?.status !== 'ARCHIVED';
      })
      .sort((a, b) => {
        const left = health.get(`${channel.id}|${normalizeUrl(a.url)}`);
        const right = health.get(`${channel.id}|${normalizeUrl(b.url)}`);
        const scoreDelta = streamHealthScore(right) - streamHealthScore(left);
        if (scoreDelta !== 0) return scoreDelta;
        if (Boolean(a.vip) !== Boolean(b.vip)) return a.vip ? 1 : -1;
        return a.url.localeCompare(b.url);
      });
    const primary = sources[0] ?? null;
    return { ...channel, url: primary?.url ?? '', referer: primary?.referer ?? null, origin: primary?.origin ?? null, sources };
  }).filter((channel) => channel.sources.length > 0 && channel.url);
}

async function persistedChannelExists(channelId: number) {
  if (!process.env.DATABASE_URL?.trim() || !Number.isInteger(channelId) || channelId <= 0) return false;
  const cached = channelExistenceCache.get(channelId);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;
  try {
    const row = await withDbReadTimeout((tx) => tx.channel.findUnique({ where: { id: channelId }, select: { id: true } }));
    const exists = Boolean(row);
    channelExistenceCache.set(channelId, { exists, expiresAt: Date.now() + (exists ? CHANNEL_EXISTS_TTL_MS : CHANNEL_MISSING_TTL_MS) });
    return exists;
  } catch (error) {
    console.warn('[stream-health] Failed to verify channel before health write.', error);
    return false;
  }
}

function pruneSourceRegistrationCache(nowMs = Date.now()) {
  for (const [key, entry] of sourceRegistrationCache) {
    if (entry.expiresAt <= nowMs) sourceRegistrationCache.delete(key);
  }
  while (sourceRegistrationCache.size > SOURCE_CACHE_MAX_ENTRIES) {
    const oldestKey = sourceRegistrationCache.keys().next().value;
    if (oldestKey === undefined) break;
    sourceRegistrationCache.delete(oldestKey);
  }
}

async function persistedSourceExists(channelId: number, url: string) {
  const normalizedUrl = normalizeUrl(url);
  if (!process.env.DATABASE_URL?.trim() || !Number.isInteger(channelId) || channelId <= 0 || !normalizedUrl) return false;
  pruneSourceRegistrationCache();
  const cacheKey = `${channelId}|${normalizedUrl}`;
  const cached = sourceRegistrationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.exists;
  try {
    const row = await withDbReadTimeout((tx) => tx.channel.findFirst({
      where: {
        id: channelId,
        OR: [
          { url: normalizedUrl },
          { sources: { some: { url: normalizedUrl } } },
        ],
      },
      select: { id: true },
    }));
    const exists = Boolean(row);
    sourceRegistrationCache.set(cacheKey, { exists, expiresAt: Date.now() + (exists ? SOURCE_EXISTS_TTL_MS : SOURCE_MISSING_TTL_MS) });
    pruneSourceRegistrationCache();
    return exists;
  } catch (error) {
    console.warn('[stream-health] Failed to verify registered stream source.', error);
    return false;
  }
}

async function quarantineChannelIfAllSourcesBroken(channelId: number) {
  if (!process.env.DATABASE_URL?.trim()) return;
  await withDbTimeout(async (tx) => {
    const channel = await tx.channel.findUnique({ where: { id: channelId }, select: { archiveStatus: true, url: true, sources: { select: { url: true } } } });
    if (!channel || channel.archiveStatus) return;
    const urls = Array.from(new Set([channel.url, ...channel.sources.map((source) => source.url)].filter(Boolean).map(normalizeUrl)));
    if (!urls.length) return;
    const records = await tx.streamHealth.findMany({ where: { channelId, url: { in: urls } }, select: { url: true, status: true } });
    const statusByUrl = new Map(records.map((record) => [normalizeUrl(record.url), record.status]));
    const allKnownBroken = urls.every((url) => statusByUrl.get(url) === 'BROKEN' || statusByUrl.get(url) === 'ARCHIVED');
    if (!allKnownBroken) return;
    await tx.channel.update({ where: { id: channelId }, data: { archiveStatus: 'SHUTDOWN', archiveNote: 'Automatically removed from the active catalog because every registered stream path is quarantined.', archiveSince: now() } });
  });
}

export async function reportStreamSuccess(input: { channelId: number; url: string; latencyMs?: number | null }) {
  if (!process.env.DATABASE_URL?.trim() || !input.channelId || !normalizeUrl(input.url)) return;
  const url = normalizeUrl(input.url);
  if (!(await persistedSourceExists(input.channelId, url))) return;
  const checkedAt = now();
  try {
    await withDbTimeout(async (tx) => {
      const existing = await tx.streamHealth.findUnique({ where: { channelId_url: { channelId: input.channelId, url } } });
      const previousAverage = existing?.averageLatencyMs ?? null;
      const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(Number(input.latencyMs))) : null;
      const averageLatency = latency == null ? previousAverage : previousAverage == null ? latency : Math.round(previousAverage * 0.7 + latency * 0.3);
      await tx.streamHealth.upsert({
        where: { channelId_url: { channelId: input.channelId, url } },
        create: { channelId: input.channelId, url, status: 'HEALTHY', successCount: 1, failureCount: 0, failureStreak: 0, lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, lastLatencyMs: latency, averageLatencyMs: averageLatency },
        update: { status: 'HEALTHY', successCount: { increment: 1 }, failureStreak: 0, lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, lastLatencyMs: latency, averageLatencyMs: averageLatency, disabledAt: null, disabledReason: null, lastError: null },
      });
      await tx.channel.updateMany({ where: { id: input.channelId, archiveStatus: 'SHUTDOWN' }, data: { archiveStatus: null, archiveNote: null, archiveSince: null } });
    });
  } catch (error) {
    console.warn('[stream-health] Failed to record success.', error);
  }
}

export async function reportStreamFailure(input: { channelId: number; url: string; error?: unknown; latencyMs?: number | null }) {
  if (!process.env.DATABASE_URL?.trim() || !input.channelId || !normalizeUrl(input.url)) return;
  const url = normalizeUrl(input.url);
  if (!(await persistedSourceExists(input.channelId, url))) return;
  const checkedAt = now();
  try {
    let shouldQuarantine = false;
    await withDbTimeout(async (tx) => {
      const existing = await tx.streamHealth.findUnique({ where: { channelId_url: { channelId: input.channelId, url } } });
      if (existing?.status === 'ARCHIVED') return;
      const failureStreak = (existing?.failureStreak ?? 0) + 1;
      const status: StreamHealthStatus = failureStreak >= BROKEN_STREAK ? 'BROKEN' : 'SUSPECT';
      const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(Number(input.latencyMs))) : null;
      const message = safeError(input.error);
      await tx.streamHealth.upsert({
        where: { channelId_url: { channelId: input.channelId, url } },
        create: { channelId: input.channelId, url, status, successCount: 0, failureCount: 1, failureStreak, lastCheckedAt: checkedAt, lastFailureAt: checkedAt, lastLatencyMs: latency, lastError: message, disabledAt: status === 'BROKEN' ? checkedAt : null, disabledReason: status === 'BROKEN' ? 'Automatic health quarantine after repeated playback failures.' : null },
        update: { status, failureCount: { increment: 1 }, failureStreak, lastCheckedAt: checkedAt, lastFailureAt: checkedAt, lastLatencyMs: latency, lastError: message, disabledAt: status === 'BROKEN' ? (existing?.disabledAt ?? checkedAt) : existing?.disabledAt, disabledReason: status === 'BROKEN' ? (existing?.disabledReason ?? 'Automatic health quarantine after repeated playback failures.') : existing?.disabledReason },
      });
      shouldQuarantine = status === 'BROKEN';
    });
    if (shouldQuarantine) await quarantineChannelIfAllSourcesBroken(input.channelId);
  } catch (error) {
    console.warn('[stream-health] Failed to record failure.', error);
  }
}

export async function listProblemStreams() {
  if (!process.env.DATABASE_URL?.trim()) return [];
  try {
    return await withDbReadTimeout((tx) => tx.streamHealth.findMany({ where: { status: { in: ['SUSPECT', 'BROKEN', 'ARCHIVED'] } }, include: { channel: { select: { id: true, name: true, nameEn: true, image: true } } }, orderBy: [{ status: 'desc' }, { failureStreak: 'desc' }, { lastFailureAt: 'desc' }] }));
  } catch (error) {
    console.warn('[stream-health] Failed to list problem streams.', error);
    return [];
  }
}

export async function updateStreamHealth(input: { channelId: number; url: string; status: StreamHealthStatus; newUrl?: string | null; reason?: string | null }) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is not configured');
  if (!(await persistedChannelExists(input.channelId))) throw new Error('Channel does not exist in the database');
  const url = normalizeUrl(input.url);
  const targetUrl = normalizeUrl(input.newUrl ?? '');
  return withDbTimeout(async (tx) => {
    const record = await tx.streamHealth.upsert({
      where: { channelId_url: { channelId: input.channelId, url } },
      create: { channelId: input.channelId, url, status: input.status, disabledAt: input.status === 'ARCHIVED' || input.status === 'BROKEN' ? now() : null, disabledReason: input.reason?.trim() || null },
      update: { status: input.status, disabledAt: input.status === 'ARCHIVED' || input.status === 'BROKEN' ? now() : null, disabledReason: input.reason?.trim() || null, ...(input.status === 'HEALTHY' ? { failureStreak: 0, lastError: null } : {}) },
    });
    if (targetUrl && targetUrl !== url) {
      const source = await tx.source.findFirst({ where: { channelId: input.channelId, url } });
      if (source) await tx.source.update({ where: { id: source.id }, data: { url: targetUrl } });
      else {
        const channel = await tx.channel.findUnique({ where: { id: input.channelId }, select: { url: true } });
        if (channel?.url === url) await tx.channel.update({ where: { id: input.channelId }, data: { url: targetUrl } });
      }
      await tx.streamHealth.update({ where: { id: record.id }, data: { url: targetUrl } });
      const cacheKey = `${input.channelId}|${url}`;
      sourceRegistrationCache.delete(cacheKey);
      pruneSourceRegistrationCache();
    }
    if (input.status === 'HEALTHY') await tx.channel.updateMany({ where: { id: input.channelId, archiveStatus: 'SHUTDOWN' }, data: { archiveStatus: null, archiveNote: null, archiveSince: null } });
    return record;
  });
}
