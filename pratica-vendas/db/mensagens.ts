import { sql } from './client';

export type Mensagem = { id: string; sessaoId: string; remetente: 'consultor' | 'ia'; texto: string; criadoEm: Date };

export async function adicionarMensagem(sessaoId: string, remetente: 'consultor' | 'ia', texto: string): Promise<void> {
  await sql`insert into mensagens (sessao_id, remetente, texto) values (${sessaoId}, ${remetente}, ${texto})`;
}

export async function listarMensagens(sessaoId: string): Promise<Mensagem[]> {
  const linhas = await sql<{ id: string; sessao_id: string; remetente: string; texto: string; criado_em: Date }[]>`
    select * from mensagens where sessao_id = ${sessaoId} order by criado_em asc
  `;
  return linhas.map((l) => ({ id: l.id, sessaoId: l.sessao_id, remetente: l.remetente as 'consultor' | 'ia', texto: l.texto, criadoEm: l.criado_em }));
}
