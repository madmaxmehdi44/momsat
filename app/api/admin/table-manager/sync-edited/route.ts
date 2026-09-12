import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { invalidateCatalogCache } from '../../../../../lib/catalog-db';

type Source = { id: number | null; title?: string | null; url: string; referer?: string | null; origin?: string | null; country?: string | null; vip?: boolean };
type Channel = { id: number; catId: number; name: string; nameEn: string; image?: string | null; url: string; referer?: string | null; origin?: string | null; vpn?: boolean; iran?: boolean; popular?: number | string; vip?: boolean; language?: string | null; country?: string | null; platform?: string | null; satellite?: string | null; frequency?: string | null; polarization?: string | null; symbolRate?: string | null; serviceId?: string | null; category: string; categoryEn: string; sources?: Source[] };

function authorized(req: NextRequest) { const expected = process.env.ADMIN_TOKEN?.trim(); return Boolean(expected && req.headers.get('x-admin-token')?.trim() === expected); }
function nullable(v: unknown) { const s = String(v ?? '').trim(); return s ? s : null; }
async function sourceId(preferred: number | null, channelId: number, url: string) {
  const same = await prisma.source.findFirst({ where: { channelId, url }, select: { id: true } }); if (same) return same.id;
  if (preferred && preferred > 0 && !(await prisma.source.findUnique({ where: { id: preferred }, select: { id: true } }))) return preferred;
  let id = Math.max(1, Math.abs([...url].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, channelId)));
  while (await prisma.source.findUnique({ where: { id }, select: { id: true } })) id += 1;
  return id;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { channels?: Channel[]; fullSync?: boolean };
    const channels = Array.isArray(body.channels) ? body.channels : [];
    const fullSync = body.fullSync === true;
    let created = 0; let updated = 0; let sourcesCreated = 0; let sourcesUpdated = 0; let channelsDeleted = 0;
    const ids = new Set(channels.map((c) => Number(c.id)).filter((id) => Number.isInteger(id) && id > 0));

    for (const channel of channels) {
      if (!channel?.id || !channel.name?.trim() || !channel.nameEn?.trim() || !channel.url?.trim()) continue;
      await prisma.category.upsert({ where: { id: Number(channel.catId) }, update: { name: channel.category || 'Uncategorized', nameEn: channel.categoryEn || 'Uncategorized' }, create: { id: Number(channel.catId), name: channel.category || 'Uncategorized', nameEn: channel.categoryEn || 'Uncategorized' } });
      const data = {
        name: channel.name.trim(), nameEn: channel.nameEn.trim(), image: nullable(channel.image), url: channel.url.trim(), referer: nullable(channel.referer), origin: nullable(channel.origin),
        vpn: Boolean(channel.vpn), iran: Boolean(channel.iran), popular: BigInt(Number(channel.popular || 0)), vip: Boolean(channel.vip), language: nullable(channel.language), country: nullable(channel.country),
        platform: nullable(channel.platform), satellite: nullable(channel.satellite), frequency: nullable(channel.frequency), polarization: nullable(channel.polarization), symbolRate: nullable(channel.symbolRate), serviceId: nullable(channel.serviceId),
        categoryId: Number(channel.catId), categoryName: channel.category || null, categoryNameEn: channel.categoryEn || null, archiveStatus: null, archiveNote: null, archiveSince: null,
      };
      const exists = await prisma.channel.findUnique({ where: { id: channel.id }, select: { id: true } });
      if (exists) { await prisma.channel.update({ where: { id: channel.id }, data }); updated += 1; } else { await prisma.channel.create({ data: { id: channel.id, ...data } }); created += 1; }

      const sourceRows = Array.isArray(channel.sources) ? channel.sources.filter((s) => s?.url?.trim()) : [];
      const keepIds: number[] = [];
      for (const source of sourceRows) {
        const same = source.id ? await prisma.source.findUnique({ where: { id: source.id }, select: { id: true, channelId: true } }) : null;
        const id = await sourceId(source.id, channel.id, source.url.trim());
        const sourceData = { channelId: channel.id, title: nullable(source.title), url: source.url.trim(), referer: nullable(source.referer), origin: nullable(source.origin), country: nullable(source.country), vip: Boolean(source.vip) };
        if (same && same.channelId === channel.id) { await prisma.source.update({ where: { id: same.id }, data: sourceData }); sourcesUpdated += 1; keepIds.push(same.id); }
        else { await prisma.source.upsert({ where: { id }, update: sourceData, create: { id, ...sourceData } }); sourcesCreated += 1; keepIds.push(id); }
      }
      await prisma.source.deleteMany({ where: { channelId: channel.id, ...(keepIds.length ? { id: { notIn: keepIds } } : {}) } });
    }

    if (fullSync) {
      const existingIds = await prisma.channel.findMany({ select: { id: true } });
      const removed = existingIds.map((x) => x.id).filter((id) => !ids.has(id));
      if (removed.length) { await prisma.channel.deleteMany({ where: { id: { in: removed } } }); channelsDeleted = removed.length; }
    }
    invalidateCatalogCache();
    return NextResponse.json({ ok: true, created, updated, sourcesCreated, sourcesUpdated, channelsDeleted, fullSync });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Edited CSV sync failed' }, { status: 400 });
  }
}