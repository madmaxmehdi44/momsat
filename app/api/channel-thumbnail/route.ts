import { NextRequest, NextResponse } from 'next/server';
import { isSafePublicUrl } from '../../../lib/web-source-extractor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url')?.trim() ?? '';
  if (!url || !(await isSafePublicUrl(url))) {
    return NextResponse.json({ ok: false, error: 'Invalid thumbnail URL.' }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      cache: 'force-cache',
      signal: AbortSignal.timeout(8000),
      headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*;q=0.8', 'user-agent': 'MomSatThumbnail/1.0' },
    });
    if (!response.ok) return new NextResponse(null, { status: 404 });

    const contentType = response.headers.get('content-type') || '';
    if (!/^image\/(?:avif|webp|png|jpe?g|gif|svg\+xml)$/i.test(contentType)) {
      return new NextResponse(null, { status: 415 });
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
        'access-control-allow-origin': '*',
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
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
