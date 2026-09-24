import { NextResponse } from 'next/server';
import { listarCenariosAtivos } from '@/db/cenarios';

export async function GET() {
  const cenarios = await listarCenariosAtivos();
  // nunca manda promptIaCliente pro navegador — é a instrução escondida da
  // personalidade do cliente simulado; expor deixaria o consultor "ler a
  // resposta" do cenário (Minor da revisão final).
  return NextResponse.json(cenarios.map((c) => ({ id: c.id, titulo: c.titulo, descricao: c.descricao })));
}
