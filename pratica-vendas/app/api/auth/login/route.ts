import { NextRequest, NextResponse } from 'next/server';
import { buscarUsuarioPorLogin } from '@/db/usuarios';
import { verificarSenha } from '@/lib/auth/senha';
import { obterHashDummy } from '@/lib/auth/hashDummy';
import { criarTokenSessao } from '@/lib/auth/sessao';

const MENSAGEM_ERRO_GENERICA = { erro: 'Usuário ou senha inválidos.' };

export async function POST(req: NextRequest) {
  const { usuario, senha } = await req.json();
  if (!usuario || !senha) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const registro = await buscarUsuarioPorLogin(usuario);

  // usuário não existe: compara contra um hash dummy PRECOMPUTADO (memoizado em
  // hashDummy.ts) em vez de gerar um novo na hora — gerar na hora soma o custo do
  // bcrypt.hash (mais caro que o compare) só nesse caminho, o que por si só já
  // revela por tempo de resposta se o usuário existe (Review Focus).
  const hashParaComparar = registro?.senhaHash ?? (await obterHashDummy());
  const senhaOk = await verificarSenha(senha, hashParaComparar);

  if (!registro || !senhaOk) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const token = await criarTokenSessao({ usuarioId: registro.id, papel: registro.papel });
  const resposta = NextResponse.json({ ok: true, papel: registro.papel });
  resposta.cookies.set('sessao', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  return resposta;
}
