import { NextRequest, NextResponse } from 'next/server';

function normalizePathname(pathname: string) {
  return pathname.replace(/\/{2,}/g, '/');
}

export function proxy(request: NextRequest) {
  const normalizedPathname = normalizePathname(request.nextUrl.pathname);
  if (normalizedPathname === request.nextUrl.pathname) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = normalizedPathname;
  return NextResponse.redirect(url, 308);
}

export const config = {
  matcher: '/:path*'
};
