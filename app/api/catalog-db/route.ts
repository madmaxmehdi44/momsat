import { NextResponse } from 'next/server';
import { getCatalog, getCategories } from '../../../lib/catalog-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const channels = await getCatalog();
    return NextResponse.json({ ok: true, source: 'database', count: channels.length, categories: getCategories(channels), channels });
  } catch (error) {
    console.error('[catalog-db]', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'database catalog fetch failed' }, { status: 500 });
  }
}
