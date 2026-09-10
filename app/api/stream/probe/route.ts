import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { ttlGetOrSet } from '../../../../../lib/ttl-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const TIMEOUT_MS = 7000;
const PROBE_TTL_MS = 15_000;

function isPrivateIp(value: string) {
  const version = net.isIP(value);
  if (version === 4) {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  }
  if (version === 6) {
    const normalized = value.toLowerCase();
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  }
  return false;
}

async function assertSafeTarget(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Only HTTP(S) URLs are allowed');

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.local') || net.isIP(hostname) && isPrivateIp(hostname)) throw new Error('Blocked target');

  try {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('Blocked target');
  } catch (error) {
    if (error instanceof Error && error.message === 'Blocked target') throw error;
    throw new Error('Unable to resolve target');
  }

  return parsed;
}

function classify(contentType: string, target: string, body: string) {
  const normalizedType = contentType.toLowerCase();
  const trimmed = body.trimStart();
  if (/mpegurl|x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(normalizedType) || /\.m3u8(?:$|\?)/i.test(target) && /^#EXTM3U\b/i.test(trimmed)) return 'hls';
  if (/video\/(mp4|webm)|audio\/mpeg/i.test(normalizedType)) return 'media';
  if (/text\/html|application\/xhtml\+xml/i.test(normalizedType)) return 'html';
  return 'unknown';
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  const referer = request.nextUrl.searchParams.get('referer')?.trim() || '';
  const origin = request.nextUrl.searchParams.get('origin')?.trim() || '';
  if (!target) return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 });

  const cacheKey = `momsat:probe:v2:${target}|${referer}|${origin}`;
  try {
    const result = await ttlGetOrSet(cacheKey, PROBE_TTL_MS, async () => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const parsed = await assertSafeTarget(target);
        const headers = new Headers({
          accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*',
          'user-agent': 'MomSatProbe/1.0',
          range: `bytes=0-${MAX_BYTES - 1}`,
        });
        if (referer) {
          const ref = await assertSafeTarget(referer);
          headers.set('referer', ref.toString());
        }
        if (origin) {
          const parsedOrigin = await assertSafeTarget(origin);
          headers.set('origin', parsedOrigin.origin);
        }

        const upstream = await fetch(parsed, { method: 'GET', headers, redirect: 'follow', cache: 'no-store', signal: controller.signal });
        const contentType = upstream.headers.get('content-type') || '';
        const finalUrl = upstream.url || parsed.toString();
        if (!upstream.ok && upstream.status !== 206) {
          return { ok: false, playable: false, status: upstream.status, contentType, finalUrl, latencyMs: Date.now() - started };
        }

        const reader = upstream.body?.getReader();
        let bytes = 0;
        let sample = '';
        if (reader) {
          while (bytes < MAX_BYTES) {
            const chunk = await reader.read();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (sample.length < 8192) sample += new TextDecoder().decode(chunk.value, { stream: true });
            if (bytes >= MAX_BYTES) break;
          }
          await reader.cancel().catch(() => undefined);
        }

        const kind = classify(contentType, finalUrl, sample);
        const playlist = kind === 'hls' ? {
          isMaster: /#EXT-X-STREAM-INF/i.test(sample),
          hasSegments: /#EXTINF:/i.test(sample),
        } : null;
        const playable = kind === 'media' || kind === 'hls' && (playlist?.isMaster || playlist?.hasSegments);

        return {
          ok: playable,
          playable,
          kind,
          status: upstream.status,
          contentType,
          finalUrl,
          bytesSampled: bytes,
          latencyMs: Date.now() - started,
          playlist,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Probe failed';
        return { ok: false, playable: false, error: message, latencyMs: Date.now() - started };
      } finally {
        clearTimeout(timer);
      }
    });

    return NextResponse.json(result, {
      status: 200,
      headers: {
        'cache-control': 'public, s-maxage=15, stale-while-revalidate=30',
        'access-control-allow-origin': '*',
      },
    });
  } catch (error) {
    return NextResponse.json({ ok: false, playable: false, error: error instanceof Error ? error.message : 'Probe failed' }, { status: 502 });
  }
}
