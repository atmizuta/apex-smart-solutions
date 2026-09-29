import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from './lib/auth/sessao';

export async function middleware(req: NextRequest) {
  const rotasPublicas = ['/login', '/api/auth/login', '/api/auth/sso'];
  if (rotasPublicas.some((r) => req.nextUrl.pathname.startsWith(r))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('sessao')?.value;
  const dados = token ? await verificarTokenSessao(token) : null;
  if (!dados) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  if (req.nextUrl.pathname.startsWith('/admin') && dados.papel !== 'admin') {
    return NextResponse.redirect(new URL('/cenarios', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
