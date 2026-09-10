import { prisma } from './prisma';
import { mergeFeaturedChannels } from './featured-channels';
import { fetchCatalog, categoriesOf, Channel } from './source';
import { ttlGetOrSet } from './ttl-cache';

export type { Channel };

const dbInclude = {
  category: { select: { name: true, nameEn: true } },
  sources: {
    orderBy: [{ vip: 'asc' as const }, { id: 'asc' as const }],
    select: { id: true, title: true, url: true, referer: true, origin: true, country: true, vip: true },
  },
};

type DbChannel = Awaited<ReturnType<typeof prisma.channel.findMany>>[number] & {
  category: { name: string; nameEn: string };
  sources: Array<{ id: number; title: string | null; url: string; referer: string | null; origin: string | null; country: string | null; vip: boolean }>;
};

function toCatalog(channel: DbChannel): Channel {
  const primary = channel.url
    ? [{ id: null, title: 'Primary', url: channel.url, referer: channel.referer, origin: channel.origin, country: channel.country ?? null, vip: channel.vip }]
    : [];
  const sources = Array.from(new Map([...primary, ...channel.sources].map((source) => [source.url, source])).values());
  return {
    id: channel.id,
    catId: channel.categoryId,
    name: channel.name,
    nameEn: channel.nameEn,
    image: channel.image,
    url: channel.url,
    referer: channel.referer,
    origin: channel.origin,
    vpn: channel.vpn,
    iran: channel.iran,
    popular: Number(channel.popular),
    vip: channel.vip,
    language: channel.language,
    country: channel.country,
    platform: channel.platform,
    satellite: channel.satellite,
    frequency: channel.frequency,
    polarization: channel.polarization,
    symbolRate: channel.symbolRate,
    serviceId: channel.serviceId,
    category: channel.categoryName || channel.category.name,
    categoryEn: channel.categoryNameEn || channel.category.nameEn,
    sources,
  };
}

async function fetchCatalogFromDb(): Promise<Channel[] | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;

  try {
    const rows = await prisma.channel.findMany({
      orderBy: [{ popular: 'desc' }, { name: 'asc' }],
      include: dbInclude,
    });
    return mergeFeaturedChannels(rows.map(toCatalog));
  } catch (error) {
    console.warn('[catalog-db] Database unavailable, falling back to configured catalog sources.', error);
    return null;
  }
}

const catalogTtlMs = () => Math.max(10_000, Number(process.env.CATALOG_CACHE_TTL_MS || 60_000));

async function loadCatalog(): Promise<Channel[]> {
  const databaseCatalog = await fetchCatalogFromDb();
  if (databaseCatalog && databaseCatalog.length > 0) return databaseCatalog;
  return mergeFeaturedChannels(await fetchCatalog());
}

export async function getCatalog() {
  return ttlGetOrSet('momsat:catalog:v2', catalogTtlMs(), loadCatalog);
}

export function getCategories(channels: Channel[]) {
  return categoriesOf(channels);
}

export async function findChannel(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;

  if (process.env.DATABASE_URL?.trim()) {
    try {
      const row = await prisma.channel.findUnique({ where: { id }, include: dbInclude });
      if (row) return mergeFeaturedChannels([toCatalog(row)])[0] ?? null;
    } catch (error) {
      console.warn('[catalog-db] Database unavailable while resolving channel, using cached catalog.', error);
    }
  }

  const channels = await getCatalog();
  return channels.find((channel) => channel.id === id) ?? null;
}
