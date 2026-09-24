import { sql } from './client';

export type Cenario = {
  id: string;
  titulo: string;
  descricao: string;
  promptIaCliente: string;
  categoria: string;
  nomeCliente: string;
  empresaCliente: string;
};

type LinhaCenario = {
  id: string;
  titulo: string;
  descricao: string;
  prompt_ia_cliente: string;
  categoria: string;
  nome_cliente: string;
  empresa_cliente: string;
};

function mapearCenario(l: LinhaCenario): Cenario {
  return {
    id: l.id,
    titulo: l.titulo,
    descricao: l.descricao,
    promptIaCliente: l.prompt_ia_cliente,
    categoria: l.categoria,
    nomeCliente: l.nome_cliente,
    empresaCliente: l.empresa_cliente,
  };
}

export async function listarCenariosAtivos(): Promise<Cenario[]> {
  const linhas = await sql<LinhaCenario[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria, nome_cliente, empresa_cliente
    from cenarios where ativo = true order by titulo
  `;
  return linhas.map(mapearCenario);
}

export async function buscarCenarioPorId(id: string): Promise<Cenario | null> {
  const linhas = await sql<LinhaCenario[]>`
    select id, titulo, descricao, prompt_ia_cliente, categoria, nome_cliente, empresa_cliente
    from cenarios where id = ${id}
  `;
  if (linhas.length === 0) return null;
  return mapearCenario(linhas[0]);
}
