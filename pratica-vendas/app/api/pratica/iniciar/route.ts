import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { criarSessao, buscarSessaoAbertaSemUso } from '@/db/sessoesPratica';

export async function POST(req: NextRequest) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const { cenarioId } = await req.json();
  if (!cenarioId) return NextResponse.json({ erro: 'cenarioId obrigatório.' }, { status: 400 });

  // já existe uma sessão de hoje pra esse cenário sem nenhuma mensagem ainda
  // (reload da tela, clique duplo)? reaproveita em vez de criar outra.
  const sessaoAberta = await buscarSessaoAbertaSemUso(dados.usuarioId, cenarioId);
  if (sessaoAberta) {
    return NextResponse.json({ sessaoId: sessaoAberta });
  }

  const sessaoId = await criarSessao(dados.usuarioId, cenarioId);
  return NextResponse.json({ sessaoId });
}
