import { NextRequest, NextResponse } from 'next/server';
import { autoSynchronizeStreamsV2 } from '../../../../lib/stream-auto-sync-v2';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  return req.headers.get('x-admin-token') === expected;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ ok: true, mode: 'auto-sync', threshold: 95, message: 'Stream Validator اکنون بدون لیست client-side اجرا می‌شود و فقط کانال‌های با امتیاز 95+ را وارد/بهینه می‌کند.' });
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    await req.json().catch(() => ({}));
    const result = await autoSynchronizeStreamsV2();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Automatic stream synchronization failed' }, { status: 500 });
  }
}
