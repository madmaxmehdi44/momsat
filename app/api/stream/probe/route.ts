import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { ttlGetOrSet } from '../../../../lib/ttl-cache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PLAYLIST_BYTES = 128 * 1024;
const MAX_SEGMENT_SAMPLE_BYTES = 4096;
const TIMEOUT_MS = 9000;
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
  if (!hostname || hostname.endsWith('.local') || (net.isIP(hostname) && isPrivateIp(hostname))) throw new Error('Blocked target');
  if (!net.isIP(hostname)) {
    const records = await dns.lookup(hostname, { all: true });
    if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('Blocked target');
  }
  return parsed;
}

function publicOrigin(raw: string) {
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function fetchSafeText(url: string, headers: Headers, signal: AbortSignal) {
  let target = url;
  for (let redirects = 0; redirects < 6; redirects += 1) {
    const parsed = await assertSafeTarget(target);
    const response = await fetch(parsed, { redirect: 'manual', cache: 'no-store', headers, signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) {
      const reader = response.body?.getReader();
      let bytes = 0;
      let sample = '';
      if (reader) {
        while (bytes < MAX_PLAYLIST_BYTES) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (sample.length < MAX_PLAYLIST_BYTES) sample += new TextDecoder().decode(chunk.value, { stream: true });
          if (bytes >= MAX_PLAYLIST_BYTES) break;
        }
        await reader.cancel().catch(() => undefined);
      }
      return { response, sample, finalUrl: response.url || parsed.toString() };
    }
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect ${response.status} without location`);
    target = new URL(location, parsed).toString();
  }
  throw new Error('Too many redirects');
}

async function fetchSample(url: string, headers: Headers, signal: AbortSignal) {
  let target = url;
  for (let redirects = 0; redirects < 6; redirects += 1) {
    const parsed = await assertSafeTarget(target);
    const response = await fetch(parsed, { redirect: 'manual', cache: 'no-store', headers, signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return { response, finalUrl: response.url || parsed.toString() };
    const location = response.headers.get('location');
    if (!location) throw new Error(`Redirect ${response.status} without location`);
    target = new URL(location, parsed).toString();
  }
  throw new Error('Too many redirects');
}

function firstPlaylistUri(text: string, baseUrl: string) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    try { return new URL(line, baseUrl).toString(); } catch { return null; }
  }
  return null;
}

function firstUriAttribute(text: string, baseUrl: string) {
  const match = text.match(/URI=("?)([^",\s]+)\1/i);
  if (!match) return null;
  try { return new URL(match[2], baseUrl).toString(); } catch { return null; }
}

function hasHls(contentType: string, url: string, body: string) {
  return /mpegurl|m3u8|x-mpegurl|application\/vnd\.apple\.mpegurl/i.test(contentType)
    || /\.m3u8(?:$|[?#])/i.test(url)
    || /^\s*#EXTM3U\b/i.test(body);
}

function looksLikeMedia(contentType: string, url: string) {
  return /video\/(?:mp4|webm)|audio\/mpeg|video\/mpeg/i.test(contentType)
    || /\.(?:mp4|webm|m4v|ts|aac|m4s|cmfv)(?:$|[?#])/i.test(url);
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  const referer = request.nextUrl.searchParams.get('referer')?.trim() || '';
  const origin = request.nextUrl.searchParams.get('origin')?.trim() || '';
  if (!target) return NextResponse.json({ ok: false, playable: false, error: 'Missing url' }, { status: 400 });

  const cacheKey = `momsat:probe:v3:${target}|${referer}|${origin}`;
  try {
    const result = await ttlGetOrSet(cacheKey, PROBE_TTL_MS, async () => {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const safeTarget = await assertSafeTarget(target);
        const baseHeaders = new Headers({
          accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/*, audio/*, */*',
          'user-agent': 'MomSatProbe/2.0',
          'accept-encoding': 'identity',
        });
        const safeReferer = referer ? await assertSafeTarget(referer) : null;
        const safeOrigin = origin ? publicOrigin(origin) : null;
        if (safeReferer) baseHeaders.set('referer', safeReferer.toString());
        if (safeOrigin) baseHeaders.set('origin', safeOrigin);

        let first = await fetchSafeText(safeTarget.toString(), baseHeaders, controller.signal);
        if ((first.response.status === 401 || first.response.status === 403) && (safeReferer || safeOrigin)) {
          const retryHeaders = new Headers(baseHeaders);
          retryHeaders.delete('referer');
          retryHeaders.delete('origin');
          first = await fetchSafeText(safeTarget.toString(), retryHeaders, controller.signal);
        }

        const firstContentType = first.response.headers.get('content-type') || '';
        const body = first.sample;
        const firstHls = hasHls(firstContentType, first.finalUrl, body);
        const firstMedia = looksLikeMedia(firstContentType, first.finalUrl);
        const result: Record<string, unknown> = {
          ok: first.response.ok || first.response.status === 206,
          playable: false,
          status: first.response.status,
          contentType: firstContentType,
          finalUrl: first.finalUrl,
          elapsedMs: Date.now() - started,
          kind: firstHls ? 'hls' : firstMedia ? 'media' : 'unknown',
          playlist: null,
          child: null,
          segment: null,
        };

        if (!first.response.ok && first.response.status !== 206) return result;
        if (firstMedia && !firstHls) {
          result.playable = true;
          result.sampleBytes = body.length;
          return result;
        }
        if (!firstHls) {
          result.sampleBytes = body.length;
          return result;
        }

        const isMaster = /#EXT-X-STREAM-INF/i.test(body);
        const childUrl = firstPlaylistUri(body, first.finalUrl);
        const uriAttribute = firstUriAttribute(body, first.finalUrl);
        const childCandidate = childUrl || uriAttribute;
        result.playlist = {
          isMaster,
          hasSegments: /#EXTINF:/i.test(body),
          hasParts: /#EXT-X-PART:/i.test(body),
          childUrl: childCandidate,
        };

        if (!childCandidate) {
          result.playable = /#EXTINF:/i.test(body);
          return result;
        }

        let child = await fetchSafeText(childCandidate, baseHeaders, controller.signal);
        if ((child.response.status === 401 || child.response.status === 403) && (safeReferer || safeOrigin)) {
          const retryHeaders = new Headers(baseHeaders);
          retryHeaders.delete('referer');
          retryHeaders.delete('origin');
          child = await fetchSafeText(childCandidate, retryHeaders, controller.signal);
        }

        const childContentType = child.response.headers.get('content-type') || '';
        const childBody = child.sample;
        result.child = {
          url: childCandidate,
          status: child.response.status,
          contentType: childContentType,
          finalUrl: child.finalUrl,
          isHls: hasHls(childContentType, child.finalUrl, childBody),
          hasSegments: /#EXTINF:/i.test(childBody),
          hasParts: /#EXT-X-PART:/i.test(childBody),
        };

        if (!child.response.ok && child.response.status !== 206) return result;
        const segmentUrl = firstPlaylistUri(childBody, child.finalUrl) || firstUriAttribute(childBody, child.finalUrl);
        if (!segmentUrl) {
          result.playable = /#EXTINF:/i.test(childBody) || /#EXT-X-PART:/i.test(childBody);
          return result;
        }

        const segmentHeaders = new Headers(baseHeaders);
        segmentHeaders.set('range', `bytes=0-${MAX_SEGMENT_SAMPLE_BYTES - 1}`);
        let segment = await fetchSample(segmentUrl, segmentHeaders, controller.signal);
        if ((segment.response.status === 401 || segment.response.status === 403) && (safeReferer || safeOrigin)) {
          const retryHeaders = new Headers(segmentHeaders);
          retryHeaders.delete('referer');
          retryHeaders.delete('origin');
          segment = await fetchSample(segmentUrl, retryHeaders, controller.signal);
        }

        const segmentStatus = segment.response.status;
        const segmentOk = (segmentStatus >= 200 && segmentStatus < 300) || segmentStatus === 206;
        result.segment = {
          url: segmentUrl,
          status: segmentStatus,
          contentType: segment.response.headers.get('content-type') || '',
          contentLength: segment.response.headers.get('content-length') || null,
          contentRange: segment.response.headers.get('content-range') || null,
          finalUrl: segment.finalUrl,
          ok: segmentOk,
        };
        result.playable = segmentOk;
        return result;
      } catch (error) {
        return {
          ok: false,
          playable: false,
          error: error instanceof Error ? error.message : 'Probe failed',
          elapsedMs: Date.now() - started,
        };
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
