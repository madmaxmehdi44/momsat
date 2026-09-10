import { NextRequest, NextResponse } from 'next/server';
import { fetchCatalogSources } from '../../../../lib/source';
import { normalizeName } from '../../../../lib/catalog-import';
import { prisma } from '../../../../lib/prisma';

export const dynamic = 'force-dynamic';

function key(name: string, nameEn: string) { return normalizeName(nameEn) || normalizeName(name); }

async function sourceId(preferred: number, channelId: number, url: string) {
  const existing = await prisma.source.findFirst({ where: { channelId, url }, select: { id: true } });
  if (existing) return existing.id;
  if (preferred && !(await prisma.source.findUnique({ where: { id: preferred }, select: { id: true } }))) return preferred;
  let id = Math.abs(Number(BigInt.asIntN(31, BigInt([...url].reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, channelId))));
  if (!id) id = 1;
  while (await prisma.source.findUnique({ where: { id }, select: { id: true } })) id = id === 2147483647 ? 1 : id + 1;
  return id;
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: 'DATABASE_URL is not configured' }, { status: 400 });
    const sourceResults = await fetchCatalogSources();
    const configuredFailures = sourceResults.filter((result) => result.status === 'failed');
    const channels = sourceResults.flatMap((result) => result.channels);
    let sources = 0, created = 0, updated = 0;
    for (const channel of channels) {
      const catalogKey = key(channel.name, channel.nameEn);
      const existing = await prisma.channel.findFirst({ where: { OR: [{ catalogKey }, { name: channel.name }, { nameEn: channel.nameEn }] }, orderBy: { id: 'asc' } });
      const channelId = existing?.id ?? channel.id;
      await prisma.category.upsert({ where: { id: channel.catId }, update: { name: channel.category, nameEn: channel.categoryEn }, create: { id: channel.catId, name: channel.category, nameEn: channel.categoryEn } });
      const data = { name: channel.name, nameEn: channel.nameEn, catalogKey, image: channel.image, url: channel.url, referer: channel.referer, origin: channel.origin, vpn: channel.vpn, iran: channel.iran, popular: channel.popular, vip: channel.vip, categoryId: channel.catId, categoryName: channel.category, categoryNameEn: channel.categoryEn };
      if (existing) { await prisma.channel.update({ where: { id: channelId }, data }); updated++; }
      else { await prisma.channel.create({ data: { id: channelId, ...data } }); created++; }
      for (const s of channel.sources) {
        if (!s.url) continue;
        const duplicate = await prisma.source.findFirst({ where: { channelId, url: s.url } });
        if (duplicate) continue;
        const id = await sourceId(s.id ?? 0, channelId, s.url);
        await prisma.source.create({ data: { id, channelId, title: s.title, url: s.url, referer: s.referer, origin: s.origin, country: s.country, vip: s.vip } });
        sources++;
      }
    }
    const skipped = sourceResults.filter((r) => r.status === 'disabled' || r.status === 'unconfigured').map((r) => ({ adapter: r.adapter, status: r.status, error: r.error }));
    const failures = configuredFailures.map((r) => ({ adapter: r.adapter, status: r.status, error: r.error }));
    return NextResponse.json({ ok: configuredFailures.length === 0, message: `Fetched ${channels.length} channels; ${created} created, ${updated} updated, ${sources} new sources`, providers: sourceResults.map((r) => ({ adapter: r.adapter, status: r.status, channels: r.channels.length, error: r.error })), skipped, failures }, { status: configuredFailures.length > 0 && channels.length === 0 ? 502 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'sync failed' }, { status: 500 });
  }
}
