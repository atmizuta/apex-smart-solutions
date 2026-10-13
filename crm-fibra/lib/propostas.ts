import type { SupabaseClient } from "@supabase/supabase-js";

export interface NovoItemProposta {
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number;
}

export interface ItemProposta extends NovoItemProposta {
  id: string;
  ordem: number;
}

export interface Proposta {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  criadoEm: string;
  itens: ItemProposta[];
  total: number;
}

interface PropostaRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  criado_em: string;
}

interface ItemRow {
  id: string;
  proposta_id: string;
  catalogo_plano_id: string | null;
  descricao: string;
  valor: number;
  ordem: number;
}

export const LIMITE_DESCRICAO = 300;

// Soma em centavos inteiros: 0.1 + 0.2 em ponto flutuante não dá 0.3.
export function somarValores(valores: number[]): number {
  const centavos = valores.reduce((soma, valor) => soma + Math.round(valor * 100), 0);
  return centavos / 100;
}

export function validarItensProposta(itens: NovoItemProposta[]): string | null {
  if (itens.length === 0) return "Adicione pelo menos uma linha à proposta";
  for (const item of itens) {
    if (!item.descricao.trim()) return "Toda linha precisa de uma descrição";
    if (item.descricao.length > LIMITE_DESCRICAO) {
      return `A descrição de uma linha passou de ${LIMITE_DESCRICAO} caracteres`;
    }
    if (!Number.isFinite(item.valor) || item.valor <= 0) {
      return "Toda linha precisa de um valor maior que zero";
    }
  }
  return null;
}

function toProposta(row: PropostaRow, itensRows: ItemRow[]): Proposta {
  const itens: ItemProposta[] = [...itensRows]
    .sort((a, b) => a.ordem - b.ordem)
    .map((item) => ({
      id: item.id,
      catalogoPlanoId: item.catalogo_plano_id,
      descricao: item.descricao,
      valor: item.valor,
      ordem: item.ordem,
    }));
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    criadoEm: row.criado_em,
    itens,
    total: somarValores(itens.map((item) => item.valor)),
  };
}

export async function criarProposta(
  client: SupabaseClient,
  input: { cnpjDigits: string; consultorId: string; itens: NovoItemProposta[] }
): Promise<Proposta> {
  const { data: cabecalho, error: erroCabecalho } = await client
    .schema("crm_fibra")
    .from("propostas")
    .insert({ cnpj_digits: input.cnpjDigits, consultor_id: input.consultorId })
    .select()
    .single();
  if (erroCabecalho) throw erroCabecalho;
  const propostaRow = cabecalho as PropostaRow;

  const linhas = input.itens.map((item, ordem) => ({
    proposta_id: propostaRow.id,
    catalogo_plano_id: item.catalogoPlanoId,
    descricao: item.descricao,
    valor: item.valor,
    ordem,
  }));
  const { data: itensRows, error: erroItens } = await client
    .schema("crm_fibra")
    .from("proposta_itens")
    .insert(linhas)
    .select();

  if (erroItens) {
    // Sem transação multi-tabela no cliente Supabase: desfaz o cabeçalho
    // para não deixar uma proposta vazia no histórico do cliente.
    await client.schema("crm_fibra").from("propostas").delete().eq("id", propostaRow.id);
    throw erroItens;
  }

  return toProposta(propostaRow, (itensRows as ItemRow[] | null) ?? []);
}

export async function listarPropostasPorCnpj(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Proposta[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("propostas")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("criado_em", { ascending: false });
  if (error) throw error;

  const propostas = (data as PropostaRow[] | null) ?? [];
  if (propostas.length === 0) return [];

  const { data: itensData, error: erroItens } = await client
    .schema("crm_fibra")
    .from("proposta_itens")
    .select()
    .in(
      "proposta_id",
      propostas.map((proposta) => proposta.id)
    )
    .order("ordem", { ascending: true });
  if (erroItens) throw erroItens;

  const itens = (itensData as ItemRow[] | null) ?? [];
  return propostas.map((proposta) =>
    toProposta(
      proposta,
      itens.filter((item) => item.proposta_id === proposta.id)
    )
  );
}
