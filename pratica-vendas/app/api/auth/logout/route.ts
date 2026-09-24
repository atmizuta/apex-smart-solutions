import { NextResponse } from 'next/server';

export async function POST() {
  const resposta = NextResponse.json({ ok: true });
  resposta.cookies.set('sessao', '', { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return resposta;
}
