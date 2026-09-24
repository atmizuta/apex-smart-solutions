import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarSessao, finalizarSessao } from '@/db/sessoesPratica';
import { listarMensagens } from '@/db/mensagens';
import { avaliarConversa } from '@/lib/ia/cliente';

// Next 16 (App Router): params chega como Promise — mesma nota do route de mensagem.
export async function POST(req: NextRequest, context: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = await context.params;

  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const sessao = await buscarSessao(sessaoId);
  if (!sessao || sessao.usuarioId !== dados.usuarioId) {
    return NextResponse.json({ erro: 'Sessão não encontrada.' }, { status: 404 });
  }
  if (sessao.finalizadoEm) {
    // já foi avaliada (clique duplo, ou outra aba) — devolve o resultado que já existe, não chama a IA de novo.
    return NextResponse.json({ nota: sessao.nota, feedback: sessao.feedback });
  }

  const mensagens = await listarMensagens(sessao.id);
  const resultado = await avaliarConversa(mensagens.map((m) => ({ remetente: m.remetente, texto: m.texto })));

  if (!resultado) {
    // falha da IA: não marca finalizado_em, então não conta pro limite diário e pode tentar de novo.
    return NextResponse.json(
      { erro: 'Não foi possível avaliar a conversa agora. Tente encerrar de novo em instantes.' },
      { status: 502 }
    );
  }

  const linhasAfetadas = await finalizarSessao(sessao.id, resultado.nota, resultado.feedback);
  if (linhasAfetadas === 0) {
    // corrida: outra requisição finalizou entre o buscarSessao e agora — busca o resultado real salvo.
    const sessaoAtualizada = await buscarSessao(sessao.id);
    return NextResponse.json({ nota: sessaoAtualizada?.nota, feedback: sessaoAtualizada?.feedback });
  }

  return NextResponse.json(resultado);
}
