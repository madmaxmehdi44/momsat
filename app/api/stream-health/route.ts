import { NextRequest, NextResponse } from 'next/server';
import { reportStreamFailure, reportStreamSuccess } from '../../../lib/stream-health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type PendingReport = Promise<void>;
const pendingReports = new Map<string, PendingReport>();
const RECENT_REPORT_TTL_MS = 2_000;
const recentReports = new Map<string, number>();

function validUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function reportKey(input: { channelId: number; url: string; outcome: 'success' | 'failure' }) {
  return `${input.channelId}|${input.url}|${input.outcome}`;
}

function enqueueReport(key: string, work: () => Promise<void>) {
  const now = Date.now();
  const recentAt = recentReports.get(key);
  if (recentAt && now - recentAt < RECENT_REPORT_TTL_MS) return;
  recentReports.set(key, now);

  const existing = pendingReports.get(key);
  if (existing) return;

  const pending = work()
    .catch((error) => {
      console.warn('[stream-health] Background telemetry write failed.', error);
    })
    .finally(() => {
      pendingReports.delete(key);
    });

  pendingReports.set(key, pending);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      channelId?: unknown;
      url?: unknown;
      outcome?: unknown;
      latencyMs?: unknown;
      error?: unknown;
    };

    const channelId = Number(body.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) {
      return NextResponse.json({ ok: false, error: 'channelId must be a positive integer' }, { status: 400 });
    }
    if (!validUrl(body.url)) {
      return NextResponse.json({ ok: false, error: 'A valid stream URL is required' }, { status: 400 });
    }
    if (body.outcome !== 'success' && body.outcome !== 'failure') {
      return NextResponse.json({ ok: false, error: 'outcome must be success or failure' }, { status: 400 });
    }

    const latencyMs = Number(body.latencyMs);
    const input = {
      channelId,
      url: String(body.url).trim(),
      latencyMs: Number.isFinite(latencyMs) ? latencyMs : null,
    };
    const outcome = body.outcome as 'success' | 'failure';
    const key = reportKey({ channelId, url: input.url, outcome });

    enqueueReport(key, async () => {
      if (outcome === 'success') {
        await reportStreamSuccess(input);
      } else {
        await reportStreamFailure({
          ...input,
          error: typeof body.error === 'string' ? body.error : 'Player playback failure',
        });
      }
    });

    return NextResponse.json(
      { ok: true, accepted: true },
      {
        status: 202,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Health report failed' },
      { status: 500 },
    );
  }
}
