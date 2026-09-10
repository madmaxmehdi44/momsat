import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 15000;
const MAX_PLAYLIST_BYTES = 512 * 1024;

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

async function safeTarget(raw: string) {
  const parsed = new URL(raw);
  if (!/^https?:$/i.test(parsed.protocol)) throw new Error('Only HTTP(S) URLs are allowed');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.local')) throw new Error('Blocked hostname');
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error('Blocked private target');
    return parsed;
  }
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) throw new Error('Blocked target');
  return parsed;
}

async function fetchText(url: string, referer?: string | null, origin?: string | null) {
  const target = await safeTarget(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = new Headers({ accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, */*', 'user-agent': 'MomSatDiagnose/1.0', 'accept-encoding': 'identity' });
    if (referer) headers.set('referer', referer);
    if (origin) headers.set('origin', origin);
    let response = await fetch(target, { redirect: 'manual', cache: 'no-store', headers, signal: controller.signal });
    if ([401, 403].includes(response.status) && (referer || origin)) {
      const retryHeaders = new Headers(headers);
      retryHeaders.delete('referer');
      retryHeaders.delete('origin');
      response = await fetch(target, { redirect: 'manual', cache: 'no-store', headers: retryHeaders, signal: controller.signal });
    }
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
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

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')?.trim() || '';
  const referer = request.nextUrl.searchParams.get('referer')?.trim() || null;
  const origin = request.nextUrl.searchParams.get('origin')?.trim() || null;
  if (!target) return NextResponse.json({ ok: false, error: 'Missing url' }, { status: 400 });

  const started = Date.now();
  try {
    const first = await fetchText(target, referer, origin);
    const contentType = first.response.headers.get('content-type') || '';
    const body = first.text.slice(0, MAX_PLAYLIST_BYTES);
    const finalUrl = first.response.url || target;
    const looksHls = /#EXTM3U/i.test(body) || /mpegurl|m3u8/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(finalUrl);

    const result: Record<string, unknown> = {
      ok: first.response.ok || first.response.status === 206,
      status: first.response.status,
      contentType,
      finalUrl,
      elapsedMs: Date.now() - started,
      isHls: looksHls,
      master: false,
      segment: null,
    };

    if (!first.response.ok && first.response.status !== 206) return NextResponse.json(result, { status: 200 });
    if (!looksHls) {
      result.sampleBytes = Buffer.byteLength(body);
      return NextResponse.json(result, { status: 200 });
    }

    const isMaster = /#EXT-X-STREAM-INF/i.test(body);
    result.master = isMaster;
    const childUrl = isMaster ? firstPlaylistUri(body, finalUrl) : firstPlaylistUri(body, finalUrl);
    const uriAttribute = firstUriAttribute(body, finalUrl);
    const candidate = childUrl || uriAttribute;
    if (!candidate) {
      result.error = 'No child playlist, segment, or URI attribute found';
      return NextResponse.json(result, { status: 200 });
    }

    const child = await fetchText(candidate, referer, origin);
    const childContentType = child.response.headers.get('content-type') || '';
    const childBody = child.text.slice(0, MAX_PLAYLIST_BYTES);
    result.child = {
      url: candidate,
      status: child.response.status,
      contentType: childContentType,
      finalUrl: child.response.url || candidate,
      isHls: /#EXTM3U/i.test(childBody) || /mpegurl|m3u8/i.test(childContentType) || /\.m3u8(?:$|[?#])/i.test(child.response.url || candidate),
    };

    if (child.response.ok || child.response.status === 206) {
      const segment = firstPlaylistUri(childBody, child.response.url || candidate) || firstUriAttribute(childBody, child.response.url || candidate);
      if (segment) {
        const seg = await safeTarget(segment);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        try {
          const headers = new Headers({ range: 'bytes=0-1023', accept: '*/*', 'user-agent': 'MomSatDiagnose/1.0', 'accept-encoding': 'identity' });
          if (referer) headers.set('referer', referer);
          if (origin) headers.set('origin', origin);
          let response = await fetch(seg, { redirect: 'manual', cache: 'no-store', headers, signal: controller.signal });
          if ([401, 403].includes(response.status) && (referer || origin)) {
            const retryHeaders = new Headers(headers);
            retryHeaders.delete('referer');
            retryHeaders.delete('origin');
            response = await fetch(seg, { redirect: 'manual', cache: 'no-store', headers: retryHeaders, signal: controller.signal });
          }
          result.segment = { url: segment, status: response.status, contentType: response.headers.get('content-type') || '', contentLength: response.headers.get('content-length') || null, contentRange: response.headers.get('content-range') || null };
        } finally {
          clearTimeout(timer);
        }
      }
    }

    result.ok = Boolean((first.response.ok || first.response.status === 206) && child.response.ok && (!result.segment || Number((result.segment as { status?: number }).status) >= 200 && Number((result.segment as { status?: number }).status) < 400));
    return NextResponse.json(result, { status: 200, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'Diagnosis failed', elapsedMs: Date.now() - started }, { status: 200, headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
  }
}
