import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { contarSessoesHoje, criarSessao } from '@/db/sessoesPratica';
import { podeIniciarSessao, LIMITE_SESSOES_POR_DIA } from '@/lib/limiteSessoes';

export async function POST(req: NextRequest) {
  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const { cenarioId } = await req.json();
  if (!cenarioId) return NextResponse.json({ erro: 'cenarioId obrigatório.' }, { status: 400 });

  const sessoesHoje = await contarSessoesHoje(dados.usuarioId);
  if (!podeIniciarSessao(sessoesHoje)) {
    return NextResponse.json(
      { erro: `Você já usou as ${LIMITE_SESSOES_POR_DIA} práticas de hoje. Volte amanhã.` },
      { status: 429 }
    );
  }

  const sessaoId = await criarSessao(dados.usuarioId, cenarioId);
  return NextResponse.json({ sessaoId });
}
