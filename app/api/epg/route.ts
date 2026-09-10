import { NextRequest, NextResponse } from 'next/server';
import { getEpg } from '../../../lib/epg';

export const dynamic = 'force-dynamic';

function dateParam(value: string | null, fallback: Date) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

export async function GET(req: NextRequest) {
  try {
    const channelIdRaw = req.nextUrl.searchParams.get('channelId');
    const channelId = channelIdRaw ? Number(channelIdRaw) : undefined;
    if (channelIdRaw && (!Number.isInteger(channelId) || channelId! <= 0)) {
      return NextResponse.json({ ok: false, error: 'invalid channelId' }, { status: 400 });
    }
    const from = dateParam(req.nextUrl.searchParams.get('from'), new Date());
    const to = dateParam(req.nextUrl.searchParams.get('to'), new Date(from.getTime() + 24 * 60 * 60_000));
    if (to <= from) return NextResponse.json({ ok: false, error: 'to must be after from' }, { status: 400 });
    const programs = await getEpg({ channelId, from, to });
    return NextResponse.json({ ok: true, from: from.toISOString(), to: to.toISOString(), count: programs.length, programs });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'EPG query failed' }, { status: 500 });
  }
}