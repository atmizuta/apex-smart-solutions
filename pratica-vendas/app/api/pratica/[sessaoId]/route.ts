import { NextRequest, NextResponse } from 'next/server';
import { verificarTokenSessao } from '@/lib/auth/sessao';
import { buscarSessao } from '@/db/sessoesPratica';
import { buscarCenarioPorId } from '@/db/cenarios';
import { listarMensagens } from '@/db/mensagens';

// Carrega o estado atual de uma sessão (mensagens + dados do cenário) —
// usado pela página de chat ao abrir/recarregar, pra não perder a conversa
// em andamento se o consultor atualizar a página (Review Focus).
export async function GET(req: NextRequest, context: { params: Promise<{ sessaoId: string }> }) {
  const { sessaoId } = await context.params;

  const dados = await verificarTokenSessao(req.cookies.get('sessao')?.value ?? '');
  if (!dados) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });

  const sessao = await buscarSessao(sessaoId);
  if (!sessao || sessao.usuarioId !== dados.usuarioId) {
    return NextResponse.json({ erro: 'Sessão não encontrada.' }, { status: 404 });
  }

  const cenario = await buscarCenarioPorId(sessao.cenarioId);
  const mensagens = await listarMensagens(sessao.id);

  return NextResponse.json({
    cenario: cenario ? { titulo: cenario.titulo, nomeCliente: cenario.nomeCliente, empresaCliente: cenario.empresaCliente } : null,
    mensagens: mensagens.map((m) => ({ remetente: m.remetente, texto: m.texto })),
    finalizado: Boolean(sessao.finalizadoEm),
    nota: sessao.nota,
    feedback: sessao.feedback,
  });
}
