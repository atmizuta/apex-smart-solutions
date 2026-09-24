import { sql } from './client';

export type Cenario = { id: string; titulo: string; descricao: string; promptIaCliente: string; categoria: string };

export async function listarCenariosAtivos(): Promise<Cenario[]> {
  const linhas = await sql<{ id: string; titulo: string; descricao: string; prompt_ia_cliente: string; categoria: string }[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria from cenarios where ativo = true order by titulo
  `;
  return linhas.map((l) => ({ id: l.id, titulo: l.titulo, descricao: l.descricao, promptIaCliente: l.prompt_ia_cliente, categoria: l.categoria }));
}

export async function buscarCenarioPorId(id: string): Promise<Cenario | null> {
  const linhas = await sql<{ id: string; titulo: string; descricao: string; prompt_ia_cliente: string; categoria: string }[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria from cenarios where id = ${id}
  `;
  if (linhas.length === 0) return null;
  const l = linhas[0];
  return { id: l.id, titulo: l.titulo, descricao: l.descricao, promptIaCliente: l.prompt_ia_cliente, categoria: l.categoria };
}
