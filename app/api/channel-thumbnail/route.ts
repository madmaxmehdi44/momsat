import { NextRequest, NextResponse } from 'next/server';
import { isSafePublicUrl } from '../../../lib/web-source-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fallbackSvg(name: string) {
  const label = (name || 'TV').trim().slice(0, 24);
  const initials = label
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0])
    .join('')
    .toUpperCase() || 'TV';
  const safeLabel = label.replace(/[&<>"']/g, '');
  const safeInitials = initials.replace(/[&<>"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#111827"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="960" height="540" rx="28" fill="url(#g)"/><circle cx="480" cy="220" r="92" fill="#1f2937" stroke="#38bdf8" stroke-width="4"/><text x="480" y="250" text-anchor="middle" font-family="Arial,sans-serif" font-size="92" font-weight="700" fill="#f8fafc">${safeInitials}</text><text x="480" y="410" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" fill="#cbd5e1">${safeLabel}</text></svg>`;
  return new NextResponse(svg, {
    status: 200,
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
      'access-control-allow-origin': '*',
    },
  });
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  const name = request.nextUrl.searchParams.get('name')?.trim() || 'TV';

  if (!url || !(await isSafePublicUrl(url))) {
    return fallbackSvg(name);
  }

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'force-cache',
      signal: AbortSignal.timeout(8000),
      headers: {
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (compatible; MomSatThumbnail/1.0)',
      },
    });

    if (!response.ok) return fallbackSvg(name);

    const contentType = response.headers.get('content-type') || '';
    const looksLikeImagePath = /\.(?:avif|webp|png|jpe?g|gif|svg)(?:$|[?#])/i.test(url);
    const acceptable = /^image\/(?:avif|webp|png|jpe?g|gif|svg\+xml)$/i.test(contentType) || looksLikeImagePath;
    if (!acceptable) return fallbackSvg(name);

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'content-type': /^image\//i.test(contentType) ? contentType : 'image/*',
        'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return fallbackSvg(name);
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
