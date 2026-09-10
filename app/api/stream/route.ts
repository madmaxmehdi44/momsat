import dns from 'node:dns/promises';
import net from 'node:net';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^::1$/i,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
];

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

async function isAllowedTarget(raw: string) {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (!/^https?:$/i.test(parsed.protocol)) return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.local') || PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);

  try {
    const records = await dns.lookup(hostname, { all: true });
    return records.length > 0 && records.every((record) => !isPrivateIp(record.address));
  } catch {
    return false;
  }
}

async function fetchSafe(initialUrl: string, headers: Headers) {
  let target = initialUrl;
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!(await isAllowedTarget(target))) throw new Error('Blocked stream target');
    const response = await fetch(target, { headers, cache: 'no-store', redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location) throw new Error('Redirect without location');
    target = new URL(location, target).toString();
  }
  throw new Error('Too many redirects');
}

function proxyUrl(target: string, referer: string | null, origin: string | null) {
  const params = new URLSearchParams({ url: target });
  if (referer) params.set('referer', referer);
  if (origin) params.set('origin', origin);
  return `/api/stream?${params.toString()}`;
}

function rewritePlaylist(text: string, request: NextRequest, referer: string | null, origin: string | null) {
  const baseUrl = new URL(request.nextUrl.searchParams.get('url')!);

  const rewrite = (candidate: string) => {
    try {
      const resolved = new URL(candidate, baseUrl).toString();
      return proxyUrl(resolved, referer, origin);
    } catch {
      return candidate;
    }
  };

  let output = text.replace(/URI=("?)([^",\s]+)\1/gi, (_match, quote, value) => `URI=${quote}${rewrite(value)}${quote}`);
  output = output
    .split(/\r?\n/)
    .map((line) => {
      const value = line.trim();
      if (!value || value.startsWith('#')) return line;
      return rewrite(value);
    })
    .join('\n');

  return output;
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  const referer = request.nextUrl.searchParams.get('referer')?.trim() || null;
  const origin = request.nextUrl.searchParams.get('origin')?.trim() || null;

  if (!target || !(await isAllowedTarget(target))) {
    return NextResponse.json({ error: 'Invalid or blocked stream URL.' }, { status: 400 });
  }

  const headers = new Headers();
  headers.set('user-agent', request.headers.get('user-agent') || 'MomSatPlayer/1.0');
  headers.set('accept', '*/*');
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  if (referer && await isAllowedTarget(referer)) headers.set('referer', referer);
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      if (/^https?:$/i.test(parsedOrigin.protocol)) headers.set('origin', parsedOrigin.origin);
    } catch {
      // Ignore malformed Origin values.
    }
  }

  try {
    const upstream = await fetchSafe(target, headers);
    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json({ error: `Upstream returned ${upstream.status}` }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || '';
    const isPlaylist = /(?:application\/vnd\.apple\.mpegurl|application\/x-mpegurl|audio\/mpegurl|\.m3u8)/i.test(contentType) || /\.m3u8(?:$|\?)/i.test(upstream.url || target);

    if (isPlaylist) {
      const text = await upstream.text();
      const body = rewritePlaylist(text, request, referer, origin);
      return new NextResponse(body, {
        status: upstream.status,
        headers: {
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'cache-control': 'no-store, no-cache, must-revalidate',
          pragma: 'no-cache',
          'access-control-allow-origin': '*',
        },
      });
    }

    const responseHeaders = new Headers();
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    responseHeaders.set('cache-control', 'no-store');
    responseHeaders.set('access-control-allow-origin', '*');
    responseHeaders.set('access-control-allow-headers', '*');

    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch (error) {
    console.error('[stream-proxy]', error);
    return NextResponse.json({ error: 'Unable to reach the stream source.' }, { status: 502 });
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
