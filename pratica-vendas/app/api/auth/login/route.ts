import { NextRequest, NextResponse } from 'next/server';
import { buscarUsuarioPorLogin } from '@/db/usuarios';
import { verificarSenha, gerarHashSenha } from '@/lib/auth/senha';
import { criarTokenSessao } from '@/lib/auth/sessao';

const MENSAGEM_ERRO_GENERICA = { erro: 'Usuário ou senha inválidos.' };

export async function POST(req: NextRequest) {
  const { usuario, senha } = await req.json();
  if (!usuario || !senha) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const registro = await buscarUsuarioPorLogin(usuario);

  // usuário não existe: ainda assim gasta o tempo de um bcrypt.compare, pra não vazar
  // por tempo de resposta se o usuário existe ou não (Review Focus).
  const hashParaComparar = registro?.senhaHash ?? (await gerarHashSenha('senha-que-nunca-bate'));
  const senhaOk = await verificarSenha(senha, hashParaComparar);

  if (!registro || !senhaOk) {
    return NextResponse.json(MENSAGEM_ERRO_GENERICA, { status: 401 });
  }

  const token = await criarTokenSessao({ usuarioId: registro.id, papel: registro.papel });
  const resposta = NextResponse.json({ ok: true, papel: registro.papel });
  resposta.cookies.set('sessao', token, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  return resposta;
}
