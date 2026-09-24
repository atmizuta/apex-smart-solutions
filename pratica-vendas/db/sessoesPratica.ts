import { sql } from './client';

export type SessaoPratica = {
  id: string;
  usuarioId: string;
  cenarioId: string;
  iniciadoEm: Date;
  avaliandoEm: Date | null;
  finalizadoEm: Date | null;
  nota: number | null;
  feedback: string | null;
};

type LinhaSessao = {
  id: string;
  usuario_id: string;
  cenario_id: string;
  iniciado_em: Date;
  avaliando_em: Date | null;
  finalizado_em: Date | null;
  nota: number | null;
  feedback: string | null;
};

function mapearSessao(l: LinhaSessao): SessaoPratica {
  return {
    id: l.id,
    usuarioId: l.usuario_id,
    cenarioId: l.cenario_id,
    iniciadoEm: l.iniciado_em,
    avaliandoEm: l.avaliando_em,
    finalizadoEm: l.finalizado_em,
    nota: l.nota,
    feedback: l.feedback,
  };
}

// Conta só sessões "reais" (finalizadas OU com pelo menos uma mensagem do
// consultor) — uma sessão criada e nunca usada (reload, aba fechada sem
// mandar nada) não deve consumir uma vaga do limite diário (Review Focus).
export async function contarSessoesHoje(usuarioId: string): Promise<number> {
  const linhas = await sql<{ total: string }[]>`
    select count(*)::text as total from sessoes_pratica s
    where s.usuario_id = ${usuarioId} and s.iniciado_em >= current_date
      and (
        s.finalizado_em is not null
        or exists (select 1 from mensagens m where m.sessao_id = s.id and m.remetente = 'consultor')
      )
  `;
  return Number(linhas[0].total);
}

// Reaproveita uma sessão do mesmo cenário, hoje, ainda sem nenhuma mensagem e
// não finalizada — evita que reload da tela de cenários ou duplo clique no
// card criem sessões vazias empilhadas (Review Focus).
export async function buscarSessaoAbertaSemUso(usuarioId: string, cenarioId: string): Promise<string | null> {
  const linhas = await sql<{ id: string }[]>`
    select s.id from sessoes_pratica s
    where s.usuario_id = ${usuarioId} and s.cenario_id = ${cenarioId}
      and s.iniciado_em >= current_date and s.finalizado_em is null
      and not exists (select 1 from mensagens m where m.sessao_id = s.id)
    order by s.iniciado_em desc
    limit 1
  `;
  return linhas.length > 0 ? linhas[0].id : null;
}

export async function criarSessao(usuarioId: string, cenarioId: string): Promise<string> {
  const linhas = await sql<{ id: string }[]>`
    insert into sessoes_pratica (usuario_id, cenario_id) values (${usuarioId}, ${cenarioId}) returning id
  `;
  return linhas[0].id;
}

export async function buscarSessao(id: string): Promise<SessaoPratica | null> {
  const linhas = await sql<LinhaSessao[]>`select * from sessoes_pratica where id = ${id}`;
  if (linhas.length === 0) return null;
  return mapearSessao(linhas[0]);
}

// Reivindica a sessão pra avaliação de forma atômica: só marca avaliando_em
// se ninguém mais estiver avaliando agora (ou se a marca antiga "travou" —
// mais de 2 minutos sem finalizar, provavelmente uma tentativa anterior que
// falhou). Um clique duplo em "Encerrar" (ou duas abas) faz a segunda
// chamada perder a corrida aqui e NUNCA chega a chamar a IA de novo
// (Review Focus).
export async function claimSessaoParaAvaliar(id: string): Promise<boolean> {
  const resultado = await sql`
    update sessoes_pratica set avaliando_em = now()
    where id = ${id}
      and finalizado_em is null
      and (avaliando_em is null or avaliando_em < now() - interval '2 minutes')
  `;
  return resultado.count > 0;
}

// só atualiza se ainda não tiver sido finalizada — segunda camada de proteção
// contra dupla avaliação, além do claim acima.
export async function finalizarSessao(id: string, nota: number, feedback: string): Promise<number> {
  const resultado = await sql`
    update sessoes_pratica set finalizado_em = now(), nota = ${nota}, feedback = ${feedback}
    where id = ${id} and finalizado_em is null
  `;
  return resultado.count;
}

// libera a marca de "avaliando" sem finalizar, pra permitir nova tentativa
// quando a chamada à IA falha (Review Focus: falha não pode deixar a sessão presa).
export async function liberarClaimAvaliacao(id: string): Promise<void> {
  await sql`update sessoes_pratica set avaliando_em = null where id = ${id} and finalizado_em is null`;
}

export async function listarSessoesPorUsuario(usuarioId: string): Promise<SessaoPratica[]> {
  const linhas = await sql<LinhaSessao[]>`select * from sessoes_pratica where usuario_id = ${usuarioId} order by iniciado_em desc`;
  return linhas.map(mapearSessao);
}

export async function listarTodasSessoes(): Promise<(SessaoPratica & { nomeUsuario: string })[]> {
  const linhas = await sql<(LinhaSessao & { nome_usuario: string })[]>`
    select s.*, u.nome as nome_usuario from sessoes_pratica s
    join usuarios u on u.id = s.usuario_id
    order by s.iniciado_em desc
  `;
  return linhas.map((l) => ({ ...mapearSessao(l), nomeUsuario: l.nome_usuario }));
}
