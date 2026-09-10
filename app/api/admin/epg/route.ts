import { NextRequest, NextResponse } from 'next/server';
import { syncEpg } from '../../../../../lib/epg';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.headers.get('x-admin-token');
  if (process.env.ADMIN_TOKEN && token !== process.env.ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ ok: false, error: 'DATABASE_URL is not configured' }, { status: 400 });
    const result = await syncEpg();
    return NextResponse.json({ ok: result.status !== 'unconfigured', ...result }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EPG sync failed' }, { status: 502 });
  }
}