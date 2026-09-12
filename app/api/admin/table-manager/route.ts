import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';
import { loadVerifiedCatalog } from '../../../../lib/verified-catalog';
import { invalidateCatalogCache } from '../../../../lib/catalog-db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const channelSelect = {
  id: true,
  name: true,
  nameEn: true,
  image: true,
  url: true,
  referer: true,
  origin: true,
  vpn: true,
  iran: true,
  popular: true,
  vip: true,
  language: true,
  country: true,
  platform: true,
  satellite: true,
  frequency: true,
  polarization: true,
  symbolRate: true,
  serviceId: true,
  categoryId: true,
  categoryName: true,
  categoryNameEn: true,
  sources: {
    orderBy: { id: 'asc' as const },
    select: { id: true, title: true, url: true, referer: true, origin: true, country: true, vip: true },
  },
};

type EditChannel = {
  id?: number;
  name: string;
  nameEn: string;
  image?: string | null;
  url: string;
  referer?: string | null;
  origin?: string | null;
  vpn?: boolean;
  iran?: boolean;
  popular?: number;
  vip?: boolean;
  language?: string | null;
  country?: string | null;
  platform?: string | null;
  satellite?: string | null;
  frequency?: string | null;
  polarization?: string | null;
  symbolRate?: string | null;
  serviceId?: string | null;
  categoryId: number;
  categoryName?: string | null;
  categoryNameEn?: string | null;
};

type EditSource = {
  id?: number;
  channelId: number;
  title?: string | null;
  url: string;
  referer?: string | null;
  origin?: string | null;
  country?: string | null;
  vip?: boolean;
};

function isAuthorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) return false;
  return req.headers.get('x-admin-token')?.trim() === expected;
}

function nullable(value: unknown) {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function int(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function bool(value: unknown) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function csvEscape(value: unknown) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function channelsToCsv(channels: Array<{
  id: number;
  name: string;
  nameEn: string;
  image: string | null;
  url: string;
  referer: string | null;
  origin: string | null;
  vpn: boolean;
  iran: boolean;
  popular: bigint;
  vip: boolean;
  categoryId: number;
  categoryName: string | null;
  categoryNameEn: string | null;
  sources: Array<{ id: number; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean }>;
}>) {
  const header = ['channel_id','category_id','channel_name','channel_name_en','channel_image','channel_url','channel_referer','channel_agent','channel_origin','need_vpn','for_iran','popular','isvip','category_name','category_name_en','channel_headers','sourses'];
  const rows = channels.map((channel) => {
    const sources = channel.sources.map((source) => ({
      ID: source.id,
      title: source.title,
      channel_url: source.url,
      channel_referer: source.referer,
      channel_origin: source.origin,
      country: source.country,
      isvip: source.vip ? 1 : 0,
      channel_headers: null,
    }));
    return [
      channel.id,
      channel.categoryId,
      channel.name,
      channel.nameEn,
      channel.image,
      channel.url,
      channel.referer,
      '',
      channel.origin,
      channel.vpn ? 1 : 0,
      channel.iran ? 1 : 0,
      channel.popular.toString(),
      channel.vip ? 1 : 0,
      channel.categoryName,
      channel.categoryNameEn,
      '',
      JSON.stringify(sources),
    ].map(csvEscape).join(',');
  });
  return `${header.join(',')}\n${rows.join('\n')}\n`;
}

async function makeId(preferred: number, channelId: number, url: string) {
  const same = await prisma.source.findFirst({ where: { channelId, url }, select: { id: true } });
  if (same) return same.id;
  if (preferred > 0) {
    const taken = await prisma.source.findUnique({ where: { id: preferred }, select: { id: true } });
    if (!taken) return preferred;
  }
  let id = Math.max(1, Math.abs([...url].reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, channelId)));
  while (await prisma.source.findUnique({ where: { id }, select: { id: true } })) id += 1;
  return id;
}

async function syncCatalogToDb() {
  const catalog = loadVerifiedCatalog();
  let created = 0;
  let updated = 0;
  let sourcesCreated = 0;

  for (const channel of catalog) {
    await prisma.category.upsert({
      where: { id: channel.catId },
      update: { name: channel.category, nameEn: channel.categoryEn },
      create: { id: channel.catId, name: channel.category, nameEn: channel.categoryEn },
    });

    const existing = await prisma.channel.findUnique({ where: { id: channel.id }, select: { id: true } });
    const data = {
      name: channel.name,
      nameEn: channel.nameEn,
      image: channel.image,
      url: channel.url,
      referer: channel.referer,
      origin: channel.origin,
      vpn: channel.vpn,
      iran: channel.iran,
      popular: BigInt(channel.popular),
      vip: channel.vip,
      language: channel.language,
      country: channel.country,
      platform: channel.platform,
      satellite: channel.satellite,
      frequency: channel.frequency,
      polarization: channel.polarization,
      symbolRate: channel.symbolRate,
      serviceId: channel.serviceId,
      categoryId: channel.catId,
      categoryName: channel.category,
      categoryNameEn: channel.categoryEn,
      archiveStatus: null,
      archiveNote: null,
      archiveSince: null,
    };
    if (existing) {
      await prisma.channel.update({ where: { id: channel.id }, data });
      updated += 1;
    } else {
      await prisma.channel.create({ data: { id: channel.id, ...data } });
      created += 1;
    }

    for (const source of channel.sources) {
      const existingSource = await prisma.source.findFirst({ where: { channelId: channel.id, url: source.url }, select: { id: true } });
      if (existingSource) {
        await prisma.source.update({ where: { id: existingSource.id }, data: { title: source.title, referer: source.referer, origin: source.origin, country: source.country, vip: source.vip } });
        continue;
      }
      const id = await makeId(source.id ?? 0, channel.id, source.url);
      await prisma.source.create({ data: { id, channelId: channel.id, title: source.title, url: source.url, referer: source.referer, origin: source.origin, country: source.country, vip: source.vip } });
      sourcesCreated += 1;
    }
  }
  invalidateCatalogCache();
  return { channelsInCsv: catalog.length, created, updated, sourcesCreated };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const [dbChannels, categories] = await Promise.all([
      prisma.channel.findMany({ orderBy: [{ popular: 'desc' }, { name: 'asc' }], select: channelSelect }),
      prisma.category.findMany({ orderBy: [{ id: 'asc' }] }),
    ]);
    const csvChannels = loadVerifiedCatalog();
    return NextResponse.json({
      ok: true,
      database: { channels: dbChannels.map((channel) => ({ ...channel, popular: channel.popular.toString() })), categories },
      csv: { channels: csvChannels },
      counts: { dbChannels: dbChannels.length, dbSources: dbChannels.reduce((sum, channel) => sum + channel.sources.length, 0), csvChannels: csvChannels.length, csvSources: csvChannels.reduce((sum, channel) => sum + channel.sources.length, 0) },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Failed to load table manager' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { action?: string; channel?: EditChannel; source?: EditSource; channels?: EditChannel[] };
    if (body.action === 'sync-csv-to-db') return NextResponse.json({ ok: true, action: body.action, result: await syncCatalogToDb() });
    if (body.action === 'export-db-csv') {
      const channels = await prisma.channel.findMany({ orderBy: { id: 'asc' }, select: channelSelect });
      return new NextResponse(channelsToCsv(channels), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="momsat-db-export.csv"' } });
    }

    if (body.action === 'delete-channel') {
      const id = int(body.channel?.id);
      if (!id) return NextResponse.json({ ok: false, error: 'Channel id is required' }, { status: 400 });
      await prisma.channel.delete({ where: { id } });
      invalidateCatalogCache();
      return NextResponse.json({ ok: true, action: body.action, id });
    }

    if (body.action === 'save-channel') {
      if (!body.channel?.name?.trim() || !body.channel.nameEn?.trim() || !body.channel.url?.trim()) return NextResponse.json({ ok: false, error: 'name, nameEn and url are required' }, { status: 400 });
      const id = int(body.channel.id);
      const data = {
        name: body.channel.name.trim(),
        nameEn: body.channel.nameEn.trim(),
        image: nullable(body.channel.image),
        url: body.channel.url.trim(),
        referer: nullable(body.channel.referer),
        origin: nullable(body.channel.origin),
        vpn: bool(body.channel.vpn),
        iran: bool(body.channel.iran),
        popular: BigInt(int(body.channel.popular)),
        vip: bool(body.channel.vip),
        language: nullable(body.channel.language),
        country: nullable(body.channel.country),
        platform: nullable(body.channel.platform),
        satellite: nullable(body.channel.satellite),
        frequency: nullable(body.channel.frequency),
        polarization: nullable(body.channel.polarization),
        symbolRate: nullable(body.channel.symbolRate),
        serviceId: nullable(body.channel.serviceId),
        categoryId: int(body.channel.categoryId),
        categoryName: nullable(body.channel.categoryName),
        categoryNameEn: nullable(body.channel.categoryNameEn),
      };
      await prisma.category.upsert({ where: { id: data.categoryId }, update: { name: data.categoryName || 'Uncategorized', nameEn: data.categoryNameEn || 'Uncategorized' }, create: { id: data.categoryId, name: data.categoryName || 'Uncategorized', nameEn: data.categoryNameEn || 'Uncategorized' } });
      const saved = id > 0 ? await prisma.channel.update({ where: { id }, data, select: channelSelect }) : await prisma.channel.create({ data: { id: undefined as never, ...data }, select: channelSelect });
      invalidateCatalogCache();
      return NextResponse.json({ ok: true, action: body.action, channel: { ...saved, popular: saved.popular.toString() } });
    }

    if (body.action === 'delete-source') {
      const id = int(body.source?.id);
      if (!id) return NextResponse.json({ ok: false, error: 'Source id is required' }, { status: 400 });
      await prisma.source.delete({ where: { id } });
      invalidateCatalogCache();
      return NextResponse.json({ ok: true, action: body.action, id });
    }

    if (body.action === 'save-source') {
      if (!body.source?.channelId || !body.source.url?.trim()) return NextResponse.json({ ok: false, error: 'channelId and url are required' }, { status: 400 });
      const id = int(body.source.id);
      const data = { channelId: int(body.source.channelId), title: nullable(body.source.title), url: body.source.url.trim(), referer: nullable(body.source.referer), origin: nullable(body.source.origin), country: nullable(body.source.country), vip: bool(body.source.vip) };
      const saved = id > 0 ? await prisma.source.update({ where: { id }, data }) : await prisma.source.create({ data: { id: await makeId(0, data.channelId, data.url), ...data } });
      invalidateCatalogCache();
      return NextResponse.json({ ok: true, action: body.action, source: saved });
    }

    return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Table manager operation failed' }, { status: 400 });
  }
}
