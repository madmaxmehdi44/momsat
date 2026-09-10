import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/prisma';
import { catalogSourceAdapters } from '../../../lib/source';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  let database: 'ok' | 'unconfigured' | 'error' = 'unconfigured';
  let channels = 0;
  let sources = 0;

  if (process.env.DATABASE_URL?.trim()) {
    try {
      [channels, sources] = await Promise.all([prisma.channel.count(), prisma.source.count()]);
      database = 'ok';
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
