import type { SupabaseClient } from "@supabase/supabase-js";
import type { SituacaoAtual } from "./fatura/tipos";

export interface NovoItemProposta {
  catalogoPlanoId: string | null;
  descricao: string;
  valor: number; // subtotal da linha: quantidade x valor unitário
  quantidade: number;
  franquiaGb: number | null; // só os planos Pós têm; é a cópia que a proposta guarda
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
  situacaoAtual: SituacaoAtual | null;
}

interface PropostaRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  criado_em: string;
  situacao_atual?: SituacaoAtual | null;
}

interface ItemRow {
  id: string;
  proposta_id: string;
  catalogo_plano_id: string | null;
  descricao: string;
  valor: number;
  ordem: number;
  quantidade?: number;
  franquia_gb?: number | null;
}

export const LIMITE_DESCRICAO = 300;
export const LIMITE_QUANTIDADE_ITEM = 1000;
const LIMITE_FRANQUIA_ITEM = 1000;

// Soma em centavos inteiros: 0.1 + 0.2 em ponto flutuante não dá 0.3.
export function somarValores(valores: number[]): number {
  const centavos = valores.reduce((soma, valor) => soma + Math.round(valor * 100), 0);
  return centavos / 100;
}

// Subtotal de uma linha (valor unitário x quantidade), também em centavos
// inteiros: 39,99 x 7 tem que dar 279,93 e não 279,92999999999995.
export function subtotalDaLinha(valorUnitario: number, quantidade: number): number {
  return (Math.round(valorUnitario * 100) * quantidade) / 100;
}

export function valorUnitarioDoItem(item: { valor: number; quantidade: number }): number {
  return Math.round((item.valor * 100) / item.quantidade) / 100;
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
    if (
      !Number.isInteger(item.quantidade) ||
      item.quantidade < 1 ||
      item.quantidade > LIMITE_QUANTIDADE_ITEM
    ) {
      return `Toda linha precisa de uma quantidade de 1 a ${LIMITE_QUANTIDADE_ITEM}`;
    }
    if (
      item.franquiaGb !== null &&
      (!Number.isInteger(item.franquiaGb) || item.franquiaGb < 1 || item.franquiaGb > LIMITE_FRANQUIA_ITEM)
    ) {
      return "A franquia de uma linha é inválida";
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
      quantidade: item.quantidade ?? 1,
      franquiaGb: item.franquia_gb ?? null,
      ordem: item.ordem,
    }));
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    criadoEm: row.criado_em,
    itens,
    total: somarValores(itens.map((item) => item.valor)),
    situacaoAtual: row.situacao_atual ?? null,
  };
}

export async function criarProposta(
  client: SupabaseClient,
  input: {
    cnpjDigits: string;
    consultorId: string;
    itens: NovoItemProposta[];
    situacaoAtual?: SituacaoAtual | null;
  }
): Promise<Proposta> {
  const { data: cabecalho, error: erroCabecalho } = await client
    .schema("crm_fibra")
    .from("propostas")
    .insert({
      cnpj_digits: input.cnpjDigits,
      consultor_id: input.consultorId,
      situacao_atual: input.situacaoAtual ?? null,
    })
    .select()
    .single();
  if (erroCabecalho) throw erroCabecalho;
  const propostaRow = cabecalho as PropostaRow;

  const linhas = input.itens.map((item, ordem) => ({
    proposta_id: propostaRow.id,
    catalogo_plano_id: item.catalogoPlanoId,
    descricao: item.descricao,
    valor: item.valor,
    quantidade: item.quantidade,
    franquia_gb: item.franquiaGb,
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

const TAMANHO_PAGINA_ITENS = 1000;

// O PostgREST corta toda resposta em 1000 linhas, em silêncio: uma empresa
// com muitas linhas por proposta e várias revisões passaria disso e a tela
// mostraria itens faltando e um total errado, sem nenhum erro.
async function buscarItens(client: SupabaseClient, propostaIds: string[]): Promise<ItemRow[]> {
  const todos: ItemRow[] = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA_ITENS) {
    const { data, error } = await client
      .schema("crm_fibra")
      .from("proposta_itens")
      .select()
      .in("proposta_id", propostaIds)
      .order("proposta_id", { ascending: true })
      .order("ordem", { ascending: true })
      .order("id", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA_ITENS - 1);
    if (error) throw error;

    const pagina = (data as ItemRow[] | null) ?? [];
    todos.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA_ITENS) return todos;
  }
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

  const itens = await buscarItens(
    client,
    propostas.map((proposta) => proposta.id)
  );
  return propostas.map((proposta) =>
    toProposta(
      proposta,
      itens.filter((item) => item.proposta_id === proposta.id)
    )
  );
}
