import { NextRequest, NextResponse } from 'next/server';
import { listProblemStreams, updateStreamHealth, type StreamHealthStatus } from '../../../../lib/stream-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  return !expected || req.headers.get('x-admin-token') === expected;
}

function validStatus(value: unknown): value is StreamHealthStatus {
  return value === 'UNKNOWN' || value === 'HEALTHY' || value === 'SUSPECT' || value === 'BROKEN' || value === 'ARCHIVED';
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const streams = await listProblemStreams();
  return NextResponse.json({ ok: true, streams, count: streams.length });
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { channelId?: unknown; url?: unknown; status?: unknown; newUrl?: unknown; reason?: unknown };
    const channelId = Number(body.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ ok: false, error: 'channelId must be a positive integer' }, { status: 400 });
    if (typeof body.url !== 'string' || !body.url.trim()) return NextResponse.json({ ok: false, error: 'url is required' }, { status: 400 });
    if (!validStatus(body.status)) return NextResponse.json({ ok: false, error: 'Invalid stream status' }, { status: 400 });
    if (body.newUrl != null && typeof body.newUrl !== 'string') return NextResponse.json({ ok: false, error: 'newUrl must be a string' }, { status: 400 });

    const result = await updateStreamHealth({
      channelId,
      url: body.url,
      status: body.status,
      newUrl: typeof body.newUrl === 'string' ? body.newUrl : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
    });
    return NextResponse.json({ ok: true, stream: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Stream health update failed' }, { status: 500 });
  }
}
