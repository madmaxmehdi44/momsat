import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === '/api/catalog') return NextResponse.rewrite(new URL('/api/catalog-db', request.url));
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/catalog'],
};
