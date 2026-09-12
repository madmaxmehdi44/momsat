import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { catalogSourceAdapters } from '../../../lib/source';
import { withDbReadTimeout, dbReadTimeoutMs } from '../../../lib/db-timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEALTH_CACHE_TTL_MS = Math.max(5_000, Number(process.env.DB_HEALTH_CACHE_TTL_MS || 15_000));
let cached: { expiresAt: number; payload: { ok: boolean; database: 'ok' | 'unconfigured' | 'error'; catalog: { channels: number; sources: number } } } | null = null;

export async function GET() {
  let payload = cached && cached.expiresAt > Date.now() ? cached.payload : null;

  if (!payload) {
    let database: 'ok' | 'unconfigured' | 'error' = 'unconfigured';
    let channels = 0;
    let sources = 0;

    if (process.env.DATABASE_URL?.trim()) {
      try {
        [channels, sources] = await withDbReadTimeout((tx) => Promise.all([
          tx.channel.count(),
          tx.source.count(),
        ]), dbReadTimeoutMs());
        database = 'ok';
      } catch {
        database = 'error';
      }
    }

    payload = {
      ok: database !== 'error',
      database,
      catalog: { channels, sources },
    };

    // Cache failures as well as successes. A failing database must not be probed
    // on every health poll while it is unreachable or its pool is exhausted.
    cached = { expiresAt: Date.now() + HEALTH_CACHE_TTL_MS, payload };
  }

  const adapters = catalogSourceAdapters.map((adapter) => ({
    id: adapter.id,
    enabled: adapter.isEnabled(),
    configured: adapter.isConfigured(),
  }));

  return NextResponse.json({
    ...payload,
    adapters,
    timestamp: new Date().toISOString(),
  }, { status: payload.ok ? 200 : 503 });
}
