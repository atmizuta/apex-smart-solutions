import type { SupabaseClient } from "@supabase/supabase-js";
import type { EtapasAbordagem } from "./ia/guia-apex";

export interface Abordagem {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  propostaId: string | null;
  etapas: EtapasAbordagem;
  modelo: string;
  criadoEm: string;
}

interface AbordagemRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  proposta_id: string | null;
  etapas: EtapasAbordagem;
  modelo: string;
  criado_em: string;
}

function toAbordagem(row: AbordagemRow): Abordagem {
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    propostaId: row.proposta_id,
    etapas: row.etapas,
    modelo: row.modelo,
    criadoEm: row.criado_em,
  };
}

// Sempre uma linha nova: dois consultores gerando para o mesmo lead não se
// sobrescrevem, e a aba só mostra a mais recente.
export async function criarAbordagem(
  client: SupabaseClient,
  input: {
    cnpjDigits: string;
    consultorId: string;
    propostaId: string | null;
    etapas: EtapasAbordagem;
    modelo: string;
  }
): Promise<Abordagem> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("abordagens")
    .insert({
      cnpj_digits: input.cnpjDigits,
      consultor_id: input.consultorId,
      proposta_id: input.propostaId,
      etapas: input.etapas,
      modelo: input.modelo,
    })
    .select()
    .single();

  if (error) throw error;
  return toAbordagem(data as AbordagemRow);
}

export async function buscarUltimaAbordagem(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Abordagem | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("abordagens")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("criado_em", { ascending: false })
    .limit(1);

  if (error) throw error;
  const rows = (data as AbordagemRow[] | null) ?? [];
  return rows.length > 0 ? toAbordagem(rows[0]) : null;
}
