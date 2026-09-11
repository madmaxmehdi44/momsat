import { NextRequest, NextResponse } from 'next/server';
import { reportStreamFailure, reportStreamSuccess } from '../../../lib/stream-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function validUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { channelId?: unknown; url?: unknown; outcome?: unknown; latencyMs?: unknown; error?: unknown };
    const channelId = Number(body.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) return NextResponse.json({ ok: false, error: 'channelId must be a positive integer' }, { status: 400 });
    if (!validUrl(body.url)) return NextResponse.json({ ok: false, error: 'A valid stream URL is required' }, { status: 400 });
    if (body.outcome !== 'success' && body.outcome !== 'failure') return NextResponse.json({ ok: false, error: 'outcome must be success or failure' }, { status: 400 });

    const latencyMs = Number(body.latencyMs);
    const input = {
      channelId,
      url: String(body.url).trim(),
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    };

    if (body.outcome === 'success') await reportStreamSuccess(input);
    else await reportStreamFailure({ ...input, error: typeof body.error === 'string' ? body.error : 'Player playback failure' });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Health report failed' }, { status: 500 });
  }
}
