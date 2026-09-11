import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { catalogSourceAdapters } from '../../../lib/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DB_HEALTH_TIMEOUT_MS = 1200;

export async function GET() {
  let database: 'ok' | 'unconfigured' | 'error' = 'unconfigured';
  let channels = 0;
  let sources = 0;

  if (process.env.DATABASE_URL?.trim()) {
    try {
      const counts = Promise.all([prisma.channel.count(), prisma.source.count()]);
      const timeout = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), DB_HEALTH_TIMEOUT_MS);
      });
      const result = await Promise.race([counts, timeout]);
      if (result) {
        [channels, sources] = result;
        database = 'ok';
      } else {
        database = 'error';
      }
    } catch {
      database = 'error';
    }
  }

  const adapters = catalogSourceAdapters.map((adapter) => ({
    id: adapter.id,
    enabled: adapter.isEnabled(),
    configured: adapter.isConfigured(),
  }));

  const ok = database !== 'error';
  return NextResponse.json({
    ok,
    database,
    catalog: { channels, sources },
    adapters,
    timestamp: new Date().toISOString(),
  }, { status: ok ? 200 : 503 });
}
