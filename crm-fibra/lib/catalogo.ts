import type { SupabaseClient } from "@supabase/supabase-js";

export type CategoriaCatalogo =
  | "convergente"
  | "pos_nacional"
  | "pos_regional"
  | "banda_larga"
  | "adicional";

export const CATEGORIAS_CATALOGO: readonly CategoriaCatalogo[] = [
  "convergente",
  "pos_nacional",
  "pos_regional",
  "banda_larga",
  "adicional",
];

export const ROTULO_CATEGORIA: Record<CategoriaCatalogo, string> = {
  convergente: "Convergentes (Fibra + Pós)",
  pos_nacional: "Claro Pós — Nacional",
  pos_regional: "Claro Pós — Regional",
  banda_larga: "Banda Larga",
  adicional: "Adicionais",
};

export interface PlanoCatalogo {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
}

interface PlanoRow {
  id: string;
  categoria: CategoriaCatalogo;
  nome: string;
  valor: number;
  observacao: string | null;
  ativo: boolean;
}

function toPlano(row: PlanoRow): PlanoCatalogo {
  return {
    id: row.id,
    categoria: row.categoria,
    nome: row.nome,
    valor: row.valor,
    observacao: row.observacao,
    ativo: row.ativo,
  };
}

export class PlanoJaExisteError extends Error {
  constructor(nome: string) {
    super(`Já existe um plano "${nome}" nesta categoria`);
    this.name = "PlanoJaExisteError";
  }
}

export async function listarCatalogo(
  client: SupabaseClient,
  opcoes: { apenasAtivos: boolean }
): Promise<PlanoCatalogo[]> {
  let query = client.schema("crm_fibra").from("catalogo_planos").select();
  if (opcoes.apenasAtivos) {
    query = query.eq("ativo", true);
  }
  const { data, error } = await query
    .order("valor", { ascending: true })
    .order("nome", { ascending: true });

  if (error) throw error;
  return ((data as PlanoRow[] | null) ?? []).map(toPlano);
}

export interface GrupoCatalogo {
  categoria: CategoriaCatalogo;
  rotulo: string;
  planos: PlanoCatalogo[];
}

// Sempre as 5 categorias, mesmo vazias: um admin que desativa todos os
// itens de uma categoria não pode quebrar a tela de ninguém.
export function agruparPorCategoria(planos: PlanoCatalogo[]): GrupoCatalogo[] {
  return CATEGORIAS_CATALOGO.map((categoria) => ({
    categoria,
    rotulo: ROTULO_CATEGORIA[categoria],
    planos: planos.filter((plano) => plano.categoria === categoria),
  }));
}

export async function criarPlano(
  client: SupabaseClient,
  input: { categoria: CategoriaCatalogo; nome: string; valor: number; observacao?: string | null }
): Promise<PlanoCatalogo> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .insert({
      categoria: input.categoria,
      nome: input.nome,
      valor: input.valor,
      observacao: input.observacao ?? null,
    })
    .select()
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new PlanoJaExisteError(input.nome);
    }
    throw error;
  }
  return toPlano(data as PlanoRow);
}

export async function atualizarPlano(
  client: SupabaseClient,
  id: string,
  campos: { valor: number; observacao: string | null }
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .update({ valor: campos.valor, observacao: campos.observacao })
    .eq("id", id);
  if (error) throw error;
}

export async function definirPlanoAtivo(
  client: SupabaseClient,
  id: string,
  ativo: boolean
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("catalogo_planos")
    .update({ ativo })
    .eq("id", id);
  if (error) throw error;
}
