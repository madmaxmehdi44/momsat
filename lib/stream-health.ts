import { prisma } from './prisma';
import type { StreamHealthStatus as PrismaStreamHealthStatus } from '@prisma/client';
import type { Channel } from './source';

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

function normalizeUrl(url: string) {
  return url.trim();
}

function safeError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error ?? 'Unknown stream error');
  return value.trim().slice(0, MAX_ERROR_LENGTH);
}

function now() {
  return new Date();
}

export function streamHealthScore(record: HealthRecord | undefined) {
  if (!record) return 45;
  if (record.status === 'ARCHIVED') return -1000;
  if (record.status === 'BROKEN') return -900;
  if (record.status === 'SUSPECT') return 5 - Math.min(20, record.failureStreak * 4);

  const latency = record.averageLatencyMs ?? record.lastLatencyMs;
  const latencyScore = latency == null ? 8 : Math.max(0, 20 - Math.min(20, latency / 100));
  const successScore = Math.min(18, Math.log10(record.successCount + 1) * 9);
  return 55 + latencyScore + successScore + Math.min(8, record.failureCount === 0 ? 8 : 2);
}

export async function getStreamHealthForChannels(channelIds: number[]) {
  if (!process.env.DATABASE_URL?.trim() || !channelIds.length) return new Map<string, HealthRecord>();
  try {
    const rows = await prisma.streamHealth.findMany({ where: { channelId: { in: channelIds } } });
    return new Map(rows.map((row) => [`${row.channelId}|${normalizeUrl(row.url)}`, row as HealthRecord]));
  } catch (error) {
    console.warn('[stream-health] Failed to load health records.', error);
    return new Map<string, HealthRecord>();
  }
}

export async function applyStreamHealth(channels: Channel[]) {
  if (!channels.length || !process.env.DATABASE_URL?.trim()) return channels;

  const health = await getStreamHealthForChannels(channels.map((channel) => channel.id));
  return channels
    .map((channel) => {
      const sources = (channel.sources ?? [])
        .filter((source) => {
          const record = health.get(`${channel.id}|${normalizeUrl(source.url)}`);
          return record?.status !== 'BROKEN' && record?.status !== 'ARCHIVED';
        })
        .sort((a, b) => {
          const left = health.get(`${channel.id}|${normalizeUrl(a.url)}`);
          const right = health.get(`${channel.id}|${normalizeUrl(b.url)}`);
          return streamHealthScore(right) - streamHealthScore(left);
        });

      const primary = sources[0] ?? null;
      return {
        ...channel,
        url: primary?.url ?? '',
        referer: primary?.referer ?? null,
        origin: primary?.origin ?? null,
        sources,
      };
    })
    .filter((channel) => channel.sources.length > 0 && channel.url);
}

async function quarantineChannelIfAllSourcesBroken(channelId: number) {
  if (!process.env.DATABASE_URL?.trim()) return;
  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    select: {
      archiveStatus: true,
      url: true,
      sources: { select: { url: true } },
    },
  });
  if (!channel || channel.archiveStatus) return;

  const urls = Array.from(new Set([channel.url, ...channel.sources.map((source) => source.url)].filter(Boolean).map(normalizeUrl)));
  if (!urls.length) return;

  const records = await prisma.streamHealth.findMany({ where: { channelId, url: { in: urls } }, select: { url: true, status: true } });
  const statusByUrl = new Map(records.map((record) => [normalizeUrl(record.url), record.status]));
  const allKnownBroken = urls.every((url) => statusByUrl.get(url) === 'BROKEN' || statusByUrl.get(url) === 'ARCHIVED');
  if (!allKnownBroken) return;

  await prisma.channel.update({
    where: { id: channelId },
    data: {
      archiveStatus: 'SHUTDOWN',
      archiveNote: 'Automatically removed from the active catalog because every registered stream path is quarantined.',
      archiveSince: now(),
    },
  });
}

export async function reportStreamSuccess(input: {
  channelId: number;
  url: string;
  latencyMs?: number | null;
}) {
  if (!process.env.DATABASE_URL?.trim() || !input.channelId || !normalizeUrl(input.url)) return;

  const url = normalizeUrl(input.url);
  const checkedAt = now();
  try {
    const existing = await prisma.streamHealth.findUnique({
      where: { channelId_url: { channelId: input.channelId, url } },
    });

    const previousAverage = existing?.averageLatencyMs ?? null;
    const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(Number(input.latencyMs))) : null;
    const averageLatency = latency == null
      ? previousAverage
      : previousAverage == null
        ? latency
        : Math.round(previousAverage * 0.7 + latency * 0.3);

    await prisma.streamHealth.upsert({
      where: { channelId_url: { channelId: input.channelId, url } },
      create: {
        channelId: input.channelId,
        url,
        status: 'HEALTHY',
        successCount: 1,
        failureCount: 0,
        failureStreak: 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastLatencyMs: latency,
        averageLatencyMs: averageLatency,
      },
      update: {
        status: 'HEALTHY',
        successCount: { increment: 1 },
        failureStreak: 0,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt,
        lastLatencyMs: latency,
        averageLatencyMs: averageLatency,
        disabledAt: null,
        disabledReason: null,
        lastError: null,
      },
    });

    await prisma.channel.updateMany({ where: { id: input.channelId, archiveStatus: 'SHUTDOWN' }, data: { archiveStatus: null, archiveNote: null, archiveSince: null } });
  } catch (error) {
    console.warn('[stream-health] Failed to record success.', error);
  }
}

export async function reportStreamFailure(input: {
  channelId: number;
  url: string;
  error?: unknown;
  latencyMs?: number | null;
}) {
  if (!process.env.DATABASE_URL?.trim() || !input.channelId || !normalizeUrl(input.url)) return;

  const url = normalizeUrl(input.url);
  const checkedAt = now();
  try {
    const existing = await prisma.streamHealth.findUnique({
      where: { channelId_url: { channelId: input.channelId, url } },
    });
    if (existing?.status === 'ARCHIVED') return;

    const failureStreak = (existing?.failureStreak ?? 0) + 1;
    const status: StreamHealthStatus = failureStreak >= BROKEN_STREAK ? 'BROKEN' : 'SUSPECT';
    const latency = Number.isFinite(input.latencyMs) ? Math.max(0, Math.round(Number(input.latencyMs))) : null;
    const message = safeError(input.error);

    await prisma.streamHealth.upsert({
      where: { channelId_url: { channelId: input.channelId, url } },
      create: {
        channelId: input.channelId,
        url,
        status,
        successCount: 0,
        failureCount: 1,
        failureStreak,
        lastCheckedAt: checkedAt,
        lastFailureAt: checkedAt,
        lastLatencyMs: latency,
        lastError: message,
        disabledAt: status === 'BROKEN' ? checkedAt : null,
        disabledReason: status === 'BROKEN' ? 'Automatic health quarantine after repeated playback failures.' : null,
      },
      update: {
        status,
        failureCount: { increment: 1 },
        failureStreak,
        lastCheckedAt: checkedAt,
        lastFailureAt: checkedAt,
        lastLatencyMs: latency,
        lastError: message,
        disabledAt: status === 'BROKEN' ? (existing?.disabledAt ?? checkedAt) : existing?.disabledAt,
        disabledReason: status === 'BROKEN' ? (existing?.disabledReason ?? 'Automatic health quarantine after repeated playback failures.') : existing?.disabledReason,
      },
    });

    if (status === 'BROKEN') await quarantineChannelIfAllSourcesBroken(input.channelId);
  } catch (error) {
    console.warn('[stream-health] Failed to record failure.', error);
  }
}

export async function listProblemStreams() {
  if (!process.env.DATABASE_URL?.trim()) return [];
  try {
    return await prisma.streamHealth.findMany({
      where: { status: { in: ['SUSPECT', 'BROKEN', 'ARCHIVED'] } },
      include: { channel: { select: { id: true, name: true, nameEn: true, image: true } } },
      orderBy: [{ status: 'desc' }, { failureStreak: 'desc' }, { lastFailureAt: 'desc' }],
    });
  } catch (error) {
    console.warn('[stream-health] Failed to list problem streams.', error);
    return [];
  }
}

export async function updateStreamHealth(input: {
  channelId: number;
  url: string;
  status: StreamHealthStatus;
  newUrl?: string | null;
  reason?: string | null;
}) {
  if (!process.env.DATABASE_URL?.trim()) throw new Error('DATABASE_URL is not configured');

  const url = normalizeUrl(input.url);
  const targetUrl = normalizeUrl(input.newUrl ?? '');
  const record = await prisma.streamHealth.upsert({
    where: { channelId_url: { channelId: input.channelId, url } },
    create: {
      channelId: input.channelId,
      url,
      status: input.status,
      disabledAt: input.status === 'ARCHIVED' || input.status === 'BROKEN' ? now() : null,
      disabledReason: input.reason?.trim() || null,
    },
    update: {
      status: input.status,
      disabledAt: input.status === 'ARCHIVED' || input.status === 'BROKEN' ? now() : null,
      disabledReason: input.reason?.trim() || null,
      ...(input.status === 'HEALTHY' ? { failureStreak: 0, lastError: null } : {}),
    },
  });

  if (targetUrl && targetUrl !== url) {
    const source = await prisma.source.findFirst({ where: { channelId: input.channelId, url } });
    if (source) {
      await prisma.source.update({ where: { id: source.id }, data: { url: targetUrl } });
    } else {
      const channel = await prisma.channel.findUnique({ where: { id: input.channelId }, select: { url: true } });
      if (channel?.url === url) {
        await prisma.channel.update({ where: { id: input.channelId }, data: { url: targetUrl } });
      }
    }
    await prisma.streamHealth.update({ where: { id: record.id }, data: { url: targetUrl } });
  }

  if (input.status === 'HEALTHY') {
    await prisma.channel.updateMany({ where: { id: input.channelId, archiveStatus: 'SHUTDOWN' }, data: { archiveStatus: null, archiveNote: null, archiveSince: null } });
  }

  return record;
}
