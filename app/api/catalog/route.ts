import { NextResponse } from 'next/server';
import { categoriesOf, fetchCatalog, type Channel } from '../../../lib/source';

export const dynamic = 'force-dynamic';

const DEFAULT_CATALOG_TTL_MS = 60_000;

type CatalogCache = {
  channels: Channel[];
  expiresAt: number;
  refreshing: Promise<Channel[]> | null;
};

const globalForCatalog = globalThis as typeof globalThis & {
  __momsatCatalogCache?: CatalogCache;
};

const catalogCache: CatalogCache =
  globalForCatalog.__momsatCatalogCache ?? {
    channels: [],
    expiresAt: 0,
    refreshing: null,
  };

globalForCatalog.__momsatCatalogCache = catalogCache;

function catalogTtlMs() {
  const value = Number(process.env.CATALOG_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 5_000
    ? Math.floor(value)
    : DEFAULT_CATALOG_TTL_MS;
}

async function refreshCatalog() {
  if (catalogCache.refreshing) return catalogCache.refreshing;

  catalogCache.refreshing = fetchCatalog()
    .then((channels) => {
      catalogCache.channels = channels;
      catalogCache.expiresAt = Date.now() + catalogTtlMs();
      return channels;
    })
    .finally(() => {
      catalogCache.refreshing = null;
    });

  return catalogCache.refreshing;
}

export async function GET() {
  try {
    const now = Date.now();

    if (catalogCache.channels.length && catalogCache.expiresAt > now) {
      return NextResponse.json(
        {
          ok: true,
          source: 'v2/posts',
          count: catalogCache.channels.length,
          categories: categoriesOf(catalogCache.channels),
          channels: catalogCache.channels,
          cached: true,
        },
        {
          headers: {
            'Cache-Control': `private, max-age=${Math.floor(catalogTtlMs() / 1000)}`,
          },
        },
      );
    }

    // After TTL expiry, serve stale data immediately and refresh in the background.
    if (catalogCache.channels.length) {
      void refreshCatalog();
      return NextResponse.json(
        {
          ok: true,
          source: 'v2/posts',
          count: catalogCache.channels.length,
          categories: categoriesOf(catalogCache.channels),
          channels: catalogCache.channels,
          cached: true,
          stale: true,
        },
        {
          headers: {
            'Cache-Control': 'private, max-age=0, must-revalidate',
          },
        },
      );
    }

    // First request still performs discovery, but concurrent callers share one fetch.
    const channels = await refreshCatalog();
    return NextResponse.json(
      {
        ok: true,
        source: 'v2/posts',
        count: channels.length,
        categories: categoriesOf(channels),
        channels,
        cached: false,
      },
      {
        headers: {
          'Cache-Control': `private, max-age=${Math.floor(catalogTtlMs() / 1000)}`,
        },
      },
    );
  } catch (e: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'catalog fetch failed',
      },
      { status: 500 },
    );
  }
}
