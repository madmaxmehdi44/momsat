import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/') return NextResponse.rewrite(new URL(`/__momsat-db/home${search}`, request.url));
  if (pathname === '/browse') return NextResponse.rewrite(new URL(`/__momsat-db/browse${search}`, request.url));
  if (pathname === '/api/catalog') return NextResponse.rewrite(new URL('/api/catalog-db', request.url));
  if (pathname === '/api/admin/table-import') return NextResponse.rewrite(new URL(`/api/admin/table-import-v2${search}`, request.url));
  const match = pathname.match(/^\/channel\/([^/]+)$/);
  if (match) return NextResponse.rewrite(new URL(`/__momsat-db/channel/${encodeURIComponent(match[1])}${search}`, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/browse', '/channel/:path*', '/api/catalog', '/api/admin/table-import'],
};
