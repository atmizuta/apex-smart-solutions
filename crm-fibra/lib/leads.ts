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

function sanitizarBusca(busca: string): string {
  return busca.replace(/[,()%*]/g, " ").trim();
}

const TAMANHO_PAGINA = 1000;

// PostgREST caps every response at 1000 rows by default, silently — this
// project has already been bitten by that exact bug once (see the
// painel's own crm/test_fetch_all_rows.js). Loop with .range() until a
// page comes back smaller than the page size, so every function reading
// leads_segmentados sees the whole table, not just the first 1000 rows.
async function buscarTodasAsLinhas<T>(
  construirQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const todas: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await construirQuery(offset, offset + TAMANHO_PAGINA - 1);
    if (error) throw error;
    const pagina = (data as T[] | null) ?? [];
    todas.push(...pagina);
    if (pagina.length < TAMANHO_PAGINA) break;
    offset += TAMANHO_PAGINA;
  }
  return todas;
}

export const TAMANHO_PAGINA_PADRAO = 25;

export interface ResultadoPaginado {
  leads: LeadSegmentado[];
  total: number;
}

export async function listarLeadsSegmentados(
  client: SupabaseClient,
  filtro: FiltroCamada,
  busca?: string,
  pagina: number = 1,
  tamanhoPagina: number = TAMANHO_PAGINA_PADRAO
): Promise<ResultadoPaginado> {
  const buscaLimpa = busca ? sanitizarBusca(busca) : "";

  let query = client.schema("crm_fibra").from("leads_segmentados").select("*", { count: "exact" });

  if (filtro === "fibra_candidato") {
    query = query.eq("camada_fibra", "fibra_candidato");
  } else if (filtro === "apto_agora" || filtro === "apto_1_mes" || filtro === "apto_2_meses") {
    query = query.eq("camada_renovacao", filtro);
  } else if (filtro === "sem_dono") {
    query = query.is("dono_consultor_id", null);
  }

  if (buscaLimpa) {
    query = query.or(
      `razao_social.ilike.%${buscaLimpa}%,cidade.ilike.%${buscaLimpa}%,cnpj_digits.ilike.%${buscaLimpa}%`
    );
  }

  const from = (pagina - 1) * tamanhoPagina;
  const to = from + tamanhoPagina - 1;

  const { data, error, count } = await query
    .order("razao_social", { ascending: true })
    .order("cnpj_digits", { ascending: true })
    .range(from, to);

  if (error) throw error;

  return {
    leads: ((data as LeadRow[] | null) ?? []).map(toLead),
    total: count ?? 0,
  };
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
  const rows = await buscarTodasAsLinhas<{
    camada_fibra: string | null;
    camada_renovacao: string | null;
    dono_consultor_id: string | null;
  }>((from, to) =>
    client
      .schema("crm_fibra")
      .from("leads_segmentados")
      .select("camada_fibra, camada_renovacao, dono_consultor_id")
      .order("cnpj_digits", { ascending: true })
      .range(from, to)
  );

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
  // Deliberately not .maybeSingle(): public.clientes has no unique
  // constraint on cnpj/cnpj_digits, so a duplicate row would make
  // .maybeSingle() throw PGRST116 and 500 this page. .limit(1) + taking
  // the first row degrades gracefully instead.
  const { data, error } = await client
    .schema("crm_fibra")
    .from("leads_segmentados")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("cnpj_digits", { ascending: true })
    .limit(1);

  if (error) throw error;
  const rows = (data as LeadRow[] | null) ?? [];
  return rows.length > 0 ? toLead(rows[0]) : null;
}

export class LeadJaAtribuidoError extends Error {
  constructor(cnpjDigits: string) {
    super(`O lead ${cnpjDigits} já foi atribuído a outro consultor`);
    this.name = "LeadJaAtribuidoError";
  }
}

export async function atribuirLead(
  client: SupabaseClient,
  cnpjDigits: string,
  consultorId: string
): Promise<void> {
  const { error } = await client
    .schema("crm_fibra")
    .from("atribuicoes")
    .insert({ cnpj_digits: cnpjDigits, consultor_id: consultorId });

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      throw new LeadJaAtribuidoError(cnpjDigits);
    }
    throw error;
  }
}

export interface Mensagem {
  id: string;
  cnpjDigits: string;
  consultorId: string;
  canal: "whatsapp" | "ligacao" | "email";
  conteudo: string;
  geradoPorIa: boolean;
  abordagemTipo: string | null;
  enviadoEm: string;
}

interface MensagemRow {
  id: string;
  cnpj_digits: string;
  consultor_id: string;
  canal: "whatsapp" | "ligacao" | "email";
  conteudo: string;
  gerado_por_ia: boolean;
  abordagem_tipo: string | null;
  enviado_em: string;
}

function toMensagem(row: MensagemRow): Mensagem {
  return {
    id: row.id,
    cnpjDigits: row.cnpj_digits,
    consultorId: row.consultor_id,
    canal: row.canal,
    conteudo: row.conteudo,
    geradoPorIa: row.gerado_por_ia,
    abordagemTipo: row.abordagem_tipo,
    enviadoEm: row.enviado_em,
  };
}

export async function listarMensagens(
  client: SupabaseClient,
  cnpjDigits: string
): Promise<Mensagem[]> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("mensagens")
    .select()
    .eq("cnpj_digits", cnpjDigits)
    .order("enviado_em", { ascending: false });

  if (error) throw error;
  return (data as MensagemRow[]).map(toMensagem);
}

export async function registrarMensagem(
  client: SupabaseClient,
  input: {
    cnpjDigits: string;
    consultorId: string;
    canal: "whatsapp" | "ligacao" | "email";
    conteudo: string;
    geradoPorIa?: boolean;
    abordagemTipo?: string;
  }
): Promise<Mensagem> {
  const { data, error } = await client
    .schema("crm_fibra")
    .from("mensagens")
    .insert({
      cnpj_digits: input.cnpjDigits,
      consultor_id: input.consultorId,
      canal: input.canal,
      conteudo: input.conteudo,
      gerado_por_ia: input.geradoPorIa ?? false,
      abordagem_tipo: input.abordagemTipo ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return toMensagem(data as MensagemRow);
}
