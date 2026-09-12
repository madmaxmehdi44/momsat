import { NextResponse } from 'next/server';
import { getCatalog } from '../../../lib/catalog-db';
import { categoriesOf, type Channel } from '../../../lib/source';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const channels = await getCatalog();
    const catalog = channels as Channel[];

    return NextResponse.json(
      {
        ok: true,
        source: 'database',
        count: catalog.length,
        categories: categoriesOf(catalog),
        channels: catalog,
        cached: true,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'catalog fetch failed' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
