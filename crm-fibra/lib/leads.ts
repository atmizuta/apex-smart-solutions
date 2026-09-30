import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadSegmentado {
  cnpjDigits: string;
  razaoSocial: string;
  cidade: string | null;
  ddd: string | null;
  tel1: string | null;
  tel2: string | null;
  telefoneContato: string | null;
  email: string | null;
  arpu: number | null;
  aptoRenovacao: string | null;
  cepCabeado: string | null;
  linhasFixas: number | null;
  camadaFibra: "fibra_candidato" | null;
  camadaRenovacao: "apto_agora" | "apto_1_mes" | "apto_2_meses" | null;
  donoConsultorId: string | null;
  statusContato: string | null;
  atribuidoEm: string | null;
  ultimoContatoEm: string | null;
}

interface LeadRow {
  cnpj_digits: string;
  razao_social: string;
  cidade: string | null;
  ddd: string | null;
  tel1: string | null;
  tel2: string | null;
  telefone_contato: string | null;
  email: string | null;
  arpu: number | null;
  apto_renovacao: string | null;
  cep_cabeado: string | null;
  linhas_fixas: number | null;
  camada_fibra: "fibra_candidato" | null;
  camada_renovacao: "apto_agora" | "apto_1_mes" | "apto_2_meses" | null;
  dono_consultor_id: string | null;
  status_contato: string | null;
  atribuido_em: string | null;
  ultimo_contato_em: string | null;
}

function toLead(row: LeadRow): LeadSegmentado {
  return {
    cnpjDigits: row.cnpj_digits,
    razaoSocial: row.razao_social,
    cidade: row.cidade,
    ddd: row.ddd,
    tel1: row.tel1,
    tel2: row.tel2,
    telefoneContato: row.telefone_contato,
    email: row.email,
    arpu: row.arpu,
    aptoRenovacao: row.apto_renovacao,
    cepCabeado: row.cep_cabeado,
    linhasFixas: row.linhas_fixas,
    camadaFibra: row.camada_fibra,
    camadaRenovacao: row.camada_renovacao,
    donoConsultorId: row.dono_consultor_id,
    statusContato: row.status_contato,
    atribuidoEm: row.atribuido_em,
    ultimoContatoEm: row.ultimo_contato_em,
  };
}

export type FiltroCamada =
  | "fibra_candidato"
  | "apto_agora"
  | "apto_1_mes"
  | "apto_2_meses"
  | "sem_dono"
  | "todos";

// Strips characters PostgREST's filter grammar treats specially (comma
// separates filters, parens group them, % and * are ILIKE/wildcard
// tokens) so user-typed search text can never restructure the .or()
// filter or inject unintended wildcards.
function sanitizarBusca(busca: string): string {
  return busca.replace(/[,()%*]/g, " ").trim();
}

export async function listarLeadsSegmentados(
  client: SupabaseClient,
  filtro: FiltroCamada,
  busca?: string
): Promise<LeadSegmentado[]> {
  let query = client.schema("crm_fibra").from("leads_segmentados").select();

  if (filtro === "fibra_candidato") {
    query = query.eq("camada_fibra", "fibra_candidato");
  } else if (filtro === "apto_agora" || filtro === "apto_1_mes" || filtro === "apto_2_meses") {
    query = query.eq("camada_renovacao", filtro);
  } else if (filtro === "sem_dono") {
    query = query.is("dono_consultor_id", null);
  }

  const buscaLimpa = busca ? sanitizarBusca(busca) : "";
  if (buscaLimpa) {
    query = query.or(
      `razao_social.ilike.${buscaLimpa},cidade.ilike.${buscaLimpa},cnpj_digits.ilike.${buscaLimpa}`
    );
  }

  const { data, error } = await query.order("razao_social", { ascending: true });
  if (error) throw error;
  return (data as LeadRow[]).map(toLead);
}

export interface ContagemCamadas {
  fibraCandidato: number;
  aptoAgora: number;
  apto1Mes: number;
  apto2Meses: number;
  semDono: number;
  total: number;
}

export async function contarPorCamada(client: SupabaseClient): Promise<ContagemCamadas> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("leads_segmentados")
    .select("camada_fibra, camada_renovacao, dono_consultor_id");

  if (error) throw error;
  const rows = data as Array<{
    camada_fibra: string | null;
    camada_renovacao: string | null;
    dono_consultor_id: string | null;
  }>;

  return {
    fibraCandidato: rows.filter((r) => r.camada_fibra === "fibra_candidato").length,
    aptoAgora: rows.filter((r) => r.camada_renovacao === "apto_agora").length,
    apto1Mes: rows.filter((r) => r.camada_renovacao === "apto_1_mes").length,
    apto2Meses: rows.filter((r) => r.camada_renovacao === "apto_2_meses").length,
    semDono: rows.filter((r) => !r.dono_consultor_id).length,
    total: rows.length,
  };
}

export async function buscarLeadPorCnpj(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<LeadSegmentado | null> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("leads_segmentados")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .maybeSingle();

  if (error) throw error;
  return data ? toLead(data as LeadRow) : null;
}
