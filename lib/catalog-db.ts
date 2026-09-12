import { prisma } from './prisma';
import { categoriesOf, Channel } from './source';
import { ensureChannelThumbnail } from './channel-thumbnail';
import { fallbackChannelThumbnail } from './fallback-thumbnail';
import { ttlDelete, ttlGet, ttlGetOrSet, ttlGetStale, ttlSet } from './ttl-cache';
import { rankCatalogChannels } from './catalog-ranking';
import { mergeFeaturedChannels } from './featured-channels';
import { applyStreamHealth } from './stream-health';
import { withDbReadTimeout } from './db-timeout';
import { loadVerifiedCatalog } from './verified-catalog';

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

const DB_CATALOG_TIMEOUT_MS = Math.max(750, Number(process.env.CATALOG_DB_TIMEOUT_MS || 1500));
const DB_FAILURE_BACKOFF_MS = Math.max(5_000, Number(process.env.CATALOG_DB_FAILURE_BACKOFF_MS || 30_000));
const SOURCE_FALLBACK_CACHE_TTL_MS = Math.max(60_000, Number(process.env.CATALOG_SOURCE_FALLBACK_TTL_MS || 600_000));

export const CATALOG_CACHE_KEY = 'momsat:catalog:v12:database-and-verified-fallback';
const SOURCE_FALLBACK_CACHE_KEY = `${CATALOG_CACHE_KEY}:verified-stale-v1`;

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

async function normalizeCatalog(channels: Channel[], includeHealth: boolean) {
  const merged = mergeFeaturedChannels(channels);
  const ranked = rankCatalogChannels(merged);
  const healthApplied = includeHealth ? await applyStreamHealth(ranked) : ranked;
  return healthApplied.map((channel) => ({
    ...channel,
    image: channel.image || fallbackChannelThumbnail(channel.nameEn || channel.name, channel.category),
  }));
}

async function fetchCatalogFromDb(): Promise<Channel[] | null> {
  if (!process.env.DATABASE_URL?.trim()) return null;
  if (Date.now() < dbBackoffUntil) return null;

  try {
    const rows = await withDbReadTimeout((tx) => tx.channel.findMany({
      where: { archiveStatus: null },
      orderBy: [{ popular: 'desc' }, { name: 'asc' }],
      include: dbInclude,
    }), DB_CATALOG_TIMEOUT_MS);
    const result = await normalizeCatalog(rows.map(toCatalog), true);
    dbBackoffUntil = 0;
    return result;
  } catch (error) {
    dbBackoffUntil = Date.now() + DB_FAILURE_BACKOFF_MS;
    console.warn(`[catalog-db] Database unavailable; serving verified catalog fallback for ${DB_FAILURE_BACKOFF_MS}ms.`, error);
    return null;
  }
}

const catalogTtlMs = () => Math.max(30_000, Number(process.env.CATALOG_CACHE_TTL_MS || 300_000));

async function loadCatalog(): Promise<Channel[]> {
  const databaseCatalog = await fetchCatalogFromDb();
  if (databaseCatalog && databaseCatalog.length > 0) {
    ttlSet(SOURCE_FALLBACK_CACHE_KEY, databaseCatalog, SOURCE_FALLBACK_CACHE_TTL_MS);
    return databaseCatalog;
  }

  const warmFallback = ttlGet<Channel[]>(SOURCE_FALLBACK_CACHE_KEY);
  if (warmFallback && warmFallback.length > 0) return warmFallback;

  const staleCatalog = ttlGetStale<Channel[]>(SOURCE_FALLBACK_CACHE_KEY);
  if (staleCatalog && staleCatalog.length > 0) return staleCatalog;

  const stalePrimary = ttlGetStale<Channel[]>(CATALOG_CACHE_KEY);
  if (stalePrimary && stalePrimary.length > 0) return stalePrimary;

  const verifiedCatalog = await normalizeCatalog(loadVerifiedCatalog(), false);
  if (verifiedCatalog.length > 0) {
    ttlSet(SOURCE_FALLBACK_CACHE_KEY, verifiedCatalog, SOURCE_FALLBACK_CACHE_TTL_MS);
    return verifiedCatalog;
  }

  return [];
}

export async function getCatalog() {
  return ttlGetOrSet(CATALOG_CACHE_KEY, catalogTtlMs(), loadCatalog);
}

/**
 * Interactive discovery uses the database when available and falls back to the
 * verified catalog committed with the application when the database is empty/unavailable.
 */
export async function getDatabaseCatalog() {
  const warmCatalog = ttlGet<Channel[]>(CATALOG_CACHE_KEY);
  if (warmCatalog && warmCatalog.length > 0) return warmCatalog;

  const staleCatalog = ttlGetStale<Channel[]>(CATALOG_CACHE_KEY);
  if (staleCatalog && staleCatalog.length > 0) return staleCatalog;

  const databaseCatalog = await fetchCatalogFromDb();
  if (databaseCatalog && databaseCatalog.length > 0) return databaseCatalog;

  return normalizeCatalog(loadVerifiedCatalog(), false);
}

export function invalidateCatalogCache() {
  ttlDelete(CATALOG_CACHE_KEY);
  ttlDelete(SOURCE_FALLBACK_CACHE_KEY);
}

export function getCategories(channels: Channel[]) {
  return categoriesOf(channels);
}

export async function findChannel(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  if (process.env.DATABASE_URL?.trim() && Date.now() >= dbBackoffUntil) {
    try {
      const row = await withDbReadTimeout((tx) => tx.channel.findUnique({ where: { id }, include: dbInclude }), DB_CATALOG_TIMEOUT_MS);
      if (row) {
        const [channel] = await normalizeCatalog([toCatalog(row)], true);
        if (channel) return channel;
      }
    } catch (error) {
      dbBackoffUntil = Date.now() + DB_FAILURE_BACKOFF_MS;
      console.warn('[catalog-db] Database unavailable while resolving channel; using cached catalog.', error);
    }
  }
  const channels = await getCatalog();
  return channels.find((channel) => channel.id === id) ?? null;
}
