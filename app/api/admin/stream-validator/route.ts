import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { updateStreamHealth } from '../../../../lib/stream-health';
import { probeStream, type StreamProbeResult } from '../../../../lib/stream-probe';
import { ttlDelete } from '../../../../lib/ttl-cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  return !expected || req.headers.get('x-admin-token') === expected;
}

async function activeChannels(ids?: number[]) {
  return prisma.channel.findMany({
    where: { archiveStatus: null, ...(ids?.length ? { id: { in: ids } } : {}) },
    select: { id: true, name: true, nameEn: true, image: true, url: true, referer: true, origin: true, sources: { select: { id: true, title: true, url: true, referer: true, origin: true, vip: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const channels = await activeChannels();
    const urls = new Set<string>();
    for (const channel of channels) { if (channel.url) urls.add(channel.url); channel.sources.forEach((source) => urls.add(source.url)); }
    return NextResponse.json({ ok: true, count: channels.length, urls: urls.size, channels });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not load streams' }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({})) as {
      action?: unknown;
      channelIds?: unknown;
      urls?: unknown;
      healthy?: unknown;
    };

    if (body.action === 'finalize') {
      const healthy = Array.isArray(body.healthy) ? body.healthy : [];
      const normalized = healthy
        .map((item) => {
          if (!item || typeof item !== 'object') return null;
          const value = item as Record<string, unknown>;
          const channelId = Number(value.channelId);
          const url = typeof value.url === 'string' ? value.url.trim() : '';
          const verdict = value.verdict;
          if (!Number.isInteger(channelId) || channelId <= 0 || !url || verdict !== 'HEALTHY') return null;
          return {
            channelId,
            channelName: typeof value.channelName === 'string' ? value.channelName : `Channel ${channelId}`,
            url,
            score: Number.isFinite(Number(value.score)) ? Number(value.score) : 0,
            reason: typeof value.reason === 'string' ? value.reason : undefined,
          };
        })
        .filter((value): value is NonNullable<typeof value> => value !== null);

      const deduped = Array.from(new Map(normalized.map((item) => [`${item.channelId}|${item.url}`, item])).values());
      let saved = 0;
      for (const item of deduped) {
        await updateStreamHealth({
          channelId: item.channelId,
          url: item.url,
          status: 'HEALTHY',
          reason: item.reason || 'خودکار ذخیره شد پس از صحت‌سنجی کامل استریم',
        });
        saved += 1;
      }

      const bestByChannel = new Map<number, (typeof deduped)[number]>();
      for (const item of deduped) {
        const current = bestByChannel.get(item.channelId);
        if (!current || item.score > current.score) bestByChannel.set(item.channelId, item);
      }

      for (const item of bestByChannel.values()) {
        await prisma.channel.update({
          where: { id: item.channelId },
          data: { url: item.url, archiveStatus: null, archiveNote: null, archiveSince: null },
        });
      }

      ttlDelete('momsat:catalog:v5:database-first-health-ranked');
      return NextResponse.json({ ok: true, saved, activatedChannels: bestByChannel.size, playlistReady: true });
    }

    const channelIds = Array.isArray(body.channelIds) ? body.channelIds.map(Number).filter((id) => Number.isInteger(id) && id > 0) : undefined;
    const requestedUrls = new Set(
      Array.isArray(body.urls)
        ? body.urls
            .filter((v): v is string => typeof v === 'string' && Boolean(v.trim()))
            .map((v) => v.trim())
        : [],
    );
    const channels = await activeChannels(channelIds?.length ? channelIds : undefined);
    const jobs: Array<{ channelId: number; channelName: string; url: string; referer: string | null; origin: string | null }> = [];
    for (const channel of channels) {
      const sources = channel.sources.length ? channel.sources : [{ id: null, title: null, url: channel.url, referer: channel.referer, origin: channel.origin, vip: false }];
      for (const source of sources) if (source.url) {
        const url = source.url.trim();
        if (url && (!requestedUrls.size || requestedUrls.has(url))) jobs.push({ channelId: channel.id, channelName: channel.name, url, referer: source.referer ?? channel.referer, origin: source.origin ?? channel.origin });
      }
    }
    const results: Array<StreamProbeResult & { channelId: number; channelName: string; referer: string | null; origin: string | null }> = [];
    const concurrency = Math.min(4, Math.max(1, Number(process.env.STREAM_PROBE_CONCURRENCY) || 4));
    let cursor = 0;
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= jobs.length) return;
        const job = jobs[index];
        const result = await probeStream(job.url, { referer: job.referer, origin: job.origin });
        results.push({ ...result, channelId: job.channelId, channelName: job.channelName, referer: job.referer, origin: job.origin });
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    results.sort((a, b) => a.channelName.localeCompare(b.channelName) || b.score - a.score);
    return NextResponse.json({ ok: true, checked: results.length, healthy: results.filter((r) => r.verdict === 'HEALTHY').length, suspect: results.filter((r) => r.verdict === 'SUSPECT').length, broken: results.filter((r) => r.verdict === 'BROKEN').length, results });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Stream validation failed' }, { status: 500 }); }
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { channelId?: unknown; url?: unknown; verdict?: unknown; reason?: unknown };
    const channelId = Number(body.channelId); const url = typeof body.url === 'string' ? body.url.trim() : '';
    if (!Number.isInteger(channelId) || channelId <= 0 || !url) return NextResponse.json({ ok: false, error: 'channelId and url are required' }, { status: 400 });
    if (body.verdict !== 'HEALTHY') return NextResponse.json({ ok: false, error: 'Only a verified HEALTHY stream can be activated.' }, { status: 400 });
    const stream = await updateStreamHealth({ channelId, url, status: 'HEALTHY', reason: typeof body.reason === 'string' ? body.reason : 'فعال‌سازی پس از صحت‌سنجی زنده توسط ادمین' });
    await prisma.channel.updateMany({ where: { id: channelId }, data: { archiveStatus: null, archiveNote: null, archiveSince: null, url } });
    ttlDelete('momsat:catalog:v5:database-first-health-ranked');
    return NextResponse.json({ ok: true, stream, activated: true, playlistReady: true });
  } catch (error) { return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Could not activate stream' }, { status: 500 }); }
}
