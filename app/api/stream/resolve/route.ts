import { NextRequest, NextResponse } from 'next/server';
import { discoverMediaSources, isSafePublicUrl } from '../../../../lib/web-source-extractor';
import { redisGetOrSet } from '../../../../lib/redis-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RESOLVE_TTL_MS = 60_000;

function looksLikeMediaUrl(url: string) {
  return /\.(?:m3u8|mp4|webm|m4v)(?:$|[?#])/i.test(url)
    || /\/(?:playlist|manifest|stream)(?:[\/?#]|$)/i.test(url)
    || /[?&](?:file|source|src|stream|playlist|manifest)=/i.test(url);
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  if (!target) return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 });
  if (!(await isSafePublicUrl(target))) return NextResponse.json({ ok: false, error: 'Invalid or blocked URL' }, { status: 400 });

  try {
    const result = looksLikeMediaUrl(target)
      ? {
          requestedUrl: target,
          sources: [{ url: target, referer: null, origin: (() => { try { return new URL(target).origin; } catch { return null; } })(), discoveredFrom: target, depth: 0 }],
          visitedPages: [],
          errors: [],
        }
      : await redisGetOrSet(`stream-resolve:v2:${target}`, RESOLVE_TTL_MS, () => discoverMediaSources(target));

    return NextResponse.json({
      ok: result.sources.length > 0,
      requestedUrl: result.requestedUrl,
      sources: result.sources,
      visitedPages: result.visitedPages,
      errors: result.errors,
    }, {
      status: 200,
      headers: {
        'cache-control': 'public, s-maxage=60, stale-while-revalidate=120',
        'access-control-allow-origin': '*',
        'x-momsat-cache': 'redis-metadata-v1',
      },
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Source resolution failed',
    }, { status: 502 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
    },
  });
}
