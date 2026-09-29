import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSso } from '@/lib/auth/ssoToken';
import { jtiJaUsado, registrarJtiUsado } from '@/db/ssoTokensUsados';
import { buscarOuCriarUsuarioPorUsername } from '@/db/usuarios';
import { criarTokenSessao } from '@/lib/auth/sessao';

// Handoff de login automático vindo da bolinha "Apex Mind" do painel: o
// consultor abre esta URL numa aba nova, já com o token assinado pela Edge
// Function do painel. Qualquer falha aqui redireciona pro /login com um
// aviso — nunca mostra um JSON cru numa aba que o usuário só vê abrir.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.redirect(new URL('/login?erro=sso_invalido', req.url));
  }

  const dados = await verificarTokenSso(token);
  if (!dados) {
    return NextResponse.redirect(new URL('/login?erro=sso_invalido', req.url));
  }

  if (await jtiJaUsado(dados.jti)) {
    return NextResponse.redirect(new URL('/login?erro=sso_expirado', req.url));
  }
  await registrarJtiUsado(dados.jti);

  const usuario = await buscarOuCriarUsuarioPorUsername(dados.sub, dados.nome, dados.papel);

  const sessaoToken = await criarTokenSessao({ usuarioId: usuario.id, papel: usuario.papel });
  const resposta = NextResponse.redirect(new URL('/cenarios', req.url));
  resposta.cookies.set('sessao', sessaoToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return resposta;
}
