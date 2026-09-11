import { NextResponse } from 'next/server';
import { redisConfigured } from '../../../../lib/redis-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    ok: true,
    redis: redisConfigured(),
    clientCache: true,
    streamAccelerator: true,
    cacheLayers: {
      browser: 'Cache Storage API',
      metadata: redisConfigured() ? 'Redis/Upstash + local fallback' : 'local fallback until Redis is configured',
      hlsSegments: 'browser/CDN short-TTL cache',
    },
  }, { headers: { 'cache-control': 'no-store' } });
}
