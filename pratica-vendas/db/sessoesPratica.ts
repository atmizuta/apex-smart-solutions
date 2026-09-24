import { sql } from './client';

export type SessaoPratica = {
  id: string;
  usuarioId: string;
  cenarioId: string;
  iniciadoEm: Date;
  finalizadoEm: Date | null;
  nota: number | null;
  feedback: string | null;
};

export async function contarSessoesHoje(usuarioId: string): Promise<number> {
  const linhas = await sql<{ total: string }[]>`
    select count(*)::text as total from sessoes_pratica
    where usuario_id = ${usuarioId} and iniciado_em >= current_date
  `;
  return Number(linhas[0].total);
}

export async function criarSessao(usuarioId: string, cenarioId: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into sessoes_pratica (usuario_id, cenario_id) values (${usuarioId}, ${cenarioId}) returning id
  `;
  return linhas[0].id;
}

export async function buscarSessao(id: string): Promise<SessaoPratica | null> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null;
  }[]>`select * from sessoes_pratica where id = ${id}`;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback };
}

// só atualiza se ainda não tiver sido finalizada — evita dupla avaliação (Review Focus).
// retorna quantas linhas foram afetadas: 0 = já estava finalizada, 1 = acabou de finalizar agora.
export async function finalizarSessao(id: string, nota: number, feedback: string): Promise<number> {
  const resultado = await sql`
    update sessoes_pratica set finalizado_em = now(), nota = ${nota}, feedback = ${feedback}
    where id = ${id} and finalizado_em is null
  `;
  return resultado.count;
}

export async function listarSessoesPorUsuario(usuarioId: string): Promise<SessaoPratica[]> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null;
  }[]>`select * from sessoes_pratica where usuario_id = ${usuarioId} order by iniciado_em desc`;
  return linhas.map((l) => ({ id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback }));
}

export async function listarTodasSessoes(): Promise<(SessaoPratica & { nomeUsuario: string })[]> {
  const linhas = await sql<{
    id: string; usuario_id: string; cenario_id: string; iniciado_em: Date; finalizado_em: Date | null; nota: number | null; feedback: string | null; nome_usuario: string;
  }[]>`
    select s.*, u.nome as nome_usuario from sessoes_pratica s
    join usuarios u on u.id = s.usuario_id
    order by s.iniciado_em desc
  `;
  return linhas.map((l) => ({ id: l.id, usuarioId: l.usuario_id, cenarioId: l.cenario_id, iniciadoEm: l.iniciado_em, finalizadoEm: l.finalizado_em, nota: l.nota, feedback: l.feedback, nomeUsuario: l.nome_usuario }));
}
