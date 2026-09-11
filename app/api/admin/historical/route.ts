import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalChannels, updateHistoricalChannel, type HistoricalStatus } from '../../../../../lib/historical-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN?.trim();
  return !expected || req.headers.get('x-admin-token') === expected;
}

function validStatus(value: unknown): value is HistoricalStatus | null {
  return value === null || value === 'MEMORY' || value === 'SHUTDOWN';
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  const raw = req.nextUrl.searchParams.get('status');
  if (raw && !validStatus(raw)) return NextResponse.json({ ok: false, error: 'Invalid status' }, { status: 400 });
  const channels = await getHistoricalChannels(raw ? raw : undefined);
  return NextResponse.json({ ok: true, channels, count: channels.length });
}

export async function PATCH(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  try {
    const body = await req.json() as { channelId?: unknown; status?: unknown; note?: unknown; since?: unknown };
    const channelId = Number(body.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ ok: false, error: 'channelId must be a positive integer' }, { status: 400 });
    if (!validStatus(body.status ?? null)) return NextResponse.json({ ok: false, error: 'status must be MEMORY, SHUTDOWN, or null' }, { status: 400 });
    if (body.since != null && (typeof body.since !== 'string' || Number.isNaN(Date.parse(body.since)))) return NextResponse.json({ ok: false, error: 'since must be an ISO date' }, { status: 400 });
    const result = await updateHistoricalChannel({ channelId, status: (body.status ?? null) as HistoricalStatus | null, note: typeof body.note === 'string' ? body.note : null, since: typeof body.since === 'string' ? body.since : null });
    return NextResponse.json({ ok: true, channel: result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Historical catalog update failed' }, { status: 500 });
  }
}
