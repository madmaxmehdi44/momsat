import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === '/api/catalog') return NextResponse.rewrite(new URL('/api/catalog-db', request.url));
  if (pathname === '/api/admin/table-import') return NextResponse.rewrite(new URL(`/api/admin/table-import-v2${search}`, request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/catalog', '/api/admin/table-import'],
};
