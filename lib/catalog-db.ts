import { prisma } from './prisma';
import { fetchCatalog, categoriesOf, Channel } from './source';
import { ensureChannelThumbnail } from './channel-thumbnail';
import { fallbackChannelThumbnail } from './fallback-thumbnail';
import { ttlGetOrSet } from './ttl-cache';
import { rankCatalogChannels } from './catalog-ranking';
import { mergeFeaturedChannels } from './featured-channels';
import { applyStreamHealth } from './stream-health';

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

const DB_CATALOG_TIMEOUT_MS = Math.max(700, Number(process.env.CATALOG_DB_TIMEOUT_MS || 1200));
const DB_FAILURE_BACKOFF_MS = Math.max(5_000, Number(process.env.CATALOG_DB_FAILURE_BACKOFF_MS || 30_000));
const STREAM_HEALTH_TIMEOUT_MS = 700;

let dbBackoffUntil = 0;

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
    image: ensureChannelThumbnail(channel.nameEn || channel.name, channel.image) || fallbackChannelThumbnail(channel.nameEn || channel.name, channel.categoryName || channel.category.name),
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function normalizeCatalog(channels: Channel[]) {
  const merged = mergeFeaturedChannels(channels);
  const ranked = rankCatalogChannels(merged);
  const healthApplied = await withTimeout(applyStreamHealth(ranked), STREAM_HEALTH_TIMEOUT_MS, ranked);
  return healthApplied.map((channel) => ({
    ...channel,
    image: channel.image || fallbackChannelThumbnail(channel.nameEn || channel.name, channel.category),
  }));
}

async function fetchCatalogFromDb(): Promise<Channel[] | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  if (Date.now() < dbBackoffUntil) return null;

  try {
    const timeout = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), DB_CATALOG_TIMEOUT_MS);
    });
    const databaseLoad = prisma.channel.findMany({
      where: { archiveStatus: null },
      orderBy: [{ popular: 'desc' }, { name: 'asc' }],
      include: dbInclude,
    }).then((rows) => normalizeCatalog(rows.map(toCatalog)));

    const result = await Promise.race([databaseLoad, timeout]);
    if (result === null) {
      dbBackoffUntil = Date.now() + DB_FAILURE_BACKOFF_MS;
      console.warn(`[catalog-db] Database catalog timed out after ${DB_CATALOG_TIMEOUT_MS}ms; using configured catalog sources for ${DB_FAILURE_BACKOFF_MS}ms.`);
      return null;
    }
    dbBackoffUntil = 0;
    return result;
  } catch (error) {
    dbBackoffUntil = Date.now() + DB_FAILURE_BACKOFF_MS;
    console.warn(`[catalog-db] Database unavailable; using configured catalog sources for ${DB_FAILURE_BACKOFF_MS}ms.`, error);
    return null;
  }
}

const catalogTtlMs = () => Math.max(10_000, Number(process.env.CATALOG_CACHE_TTL_MS || 60_000));

async function loadCatalog(): Promise<Channel[]> {
  const databaseCatalog = await fetchCatalogFromDb();
  if (databaseCatalog && databaseCatalog.length > 0) return databaseCatalog;
  return normalizeCatalog(await fetchCatalog());
}

export async function getCatalog() {
  return ttlGetOrSet('momsat:catalog:v8:database-first-health-ranked-reliable-thumbnails-with-db-backoff', catalogTtlMs(), loadCatalog);
}

export function getCategories(channels: Channel[]) {
  return categoriesOf(channels);
}

export async function findChannel(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (process.env.DATABASE_URL?.trim() && Date.now() >= dbBackoffUntil) {
    try {
      const row = await prisma.channel.findUnique({ where: { id }, include: dbInclude });
      if (row) {
        const [channel] = await normalizeCatalog([toCatalog(row)]);
        if (channel) return channel;
      }
    } catch (error) {
      dbBackoffUntil = Date.now() + DB_FAILURE_BACKOFF_MS;
      console.warn('[catalog-db] Database unavailable while resolving channel, using cached catalog.', error);
    }
  }
  const channels = await getCatalog();
  return channels.find((channel) => channel.id === id) ?? null;
}
