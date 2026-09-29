import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarSessao } from '@/db/sessoesPratica';
import { buscarCenarioPorId } from '@/db/cenarios';
import { adicionarMensagem, listarMensagens } from '@/db/mensagens';
import { construirPromptCliente } from '@/lib/cenarios/prompt';
import { responderComoCliente } from '@/lib/ia/cliente';

// Next 16 (App Router): params chega como Promise — precisa await antes de usar
// (ruling registrada no ledger do Task 1, junto com a atualização de next@14 -> next@16).
export async function POST(req: NextRequest, context: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = await context.params;

  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const { texto } = await req.json();
  if (!texto || !texto.trim()) {
    return NextResponse.json({ erro: 'Mensagem vazia.' }, { status: 400 });
  }

  const sessao = await buscarSessao(sessaoId);
  if (!sessao || sessao.usuarioId !== dados.usuarioId) {
    return NextResponse.json({ erro: 'Sessão não encontrada.' }, { status: 404 });
  }
  if (sessao.finalizadoEm) {
    return NextResponse.json({ erro: 'Esta sessão já foi encerrada.' }, { status: 400 });
  }

  const cenario = await buscarCenarioPorId(sessao.cenarioId);
  if (!cenario) return NextResponse.json({ erro: 'Cenário não encontrado.' }, { status: 404 });

  await adicionarMensagem(sessao.id, 'consultor', texto.trim());
  const historico = await listarMensagens(sessao.id);

  let resultado: { resposta: string; dica: string | null };
  try {
    resultado = await responderComoCliente(
      construirPromptCliente(cenario),
      historico.map((m) => ({ remetente: m.remetente, texto: m.texto }))
    );
  } catch (erro) {
    console.error('Falha ao chamar a IA no roleplay:', erro);
    return NextResponse.json(
      { erro: 'A simulação falhou temporariamente. Tente enviar a mensagem de novo.' },
      { status: 502 }
    );
  }

  // a dica é uma orientação em tempo real pro consultor, fora do personagem —
  // não faz parte da fala do cliente, então só a transcrição (resposta) vai
  // pra tabela de mensagens; a dica é devolvida direto e some no reload
  // (é uma dica do momento, não histórico permanente).
  await adicionarMensagem(sessao.id, 'ia', resultado.resposta);
  return NextResponse.json({ resposta: resultado.resposta, dica: resultado.dica });
}
