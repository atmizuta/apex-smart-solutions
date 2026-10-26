// Funções puras da planilha de leads (§112). Sem rede e sem Deno: testadas com `node --test`.
// Spec: docs/superpowers/specs/2026-10-26-leads-kanban-planilha-design.md
export const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
export type Guia = { titulo: string; indice: number };
export type CfgPlanilha = { sheet_id: string; entrada_prefixo: string; guia_mes_contem: string; guias_fixas?: Record<string, string>; entrada_desde?: string };
export type Indices = { id: number; consultor: number; status: number; obs: number; converteu: number; receita: number };
export type Cabecalho = { linha: number; colunas: string[]; idx: Indices };
export type LeadPlanilha = {
  aba: string; id: string; criado_em_lead: string | null; ad_id?: string | null; ad_name?: string | null;
  adset_id?: string | null; adset_name?: string | null; campaign_id?: string | null; campaign_name?: string | null;
  form_id?: string | null; form_name?: string | null; is_organic?: boolean | null; platform?: string | null;
  tipo_empresa?: string | null; qtd_linhas?: string | null; cnpj?: string | null; email?: string | null;
  full_name?: string | null; city?: string | null; state?: string | null; phone_number?: string | null;
  lead_status?: string | null; consultor: string | null; status: string | null; obs: string | null;
  converteu: boolean | null; receita: number | null;
};
export type Escrita = { range: string; values: string[][] };

export function norm(s: string): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function guiaEntrada(guias: Guia[], cfg: CfgPlanilha): Guia | null {
  const p = norm(cfg.entrada_prefixo);
  return [...guias].sort((a, b) => a.indice - b.indice).find((g) => norm(g.titulo).startsWith(p)) ?? null;
}

// Guias candidatas do mês do lead: título com o nome do mês (palavra inteira) + o trecho "CLARO B2B", fora a de entrada.
// guias_fixas sobrescreve (AGOSTO vive na própria guia FORM-).
export function guiasDoMes(guias: Guia[], aba: string, cfg: CfgPlanilha): Guia[] {
  const fixa = cfg.guias_fixas?.[aba];
  if (fixa) return guias.filter((g) => g.titulo === fixa);
  const mes = norm(aba), contem = norm(cfg.guia_mes_contem), pref = norm(cfg.entrada_prefixo);
  const reMes = new RegExp(`(^|[^A-Z])${mes}([^A-Z]|$)`);
  return guias
    .filter((g) => { const t = norm(g.titulo); return !t.startsWith(pref) && t.includes(contem) && reMes.test(t); })
    .sort((a, b) => a.indice - b.indice);
}

// Mais de uma guia do mês: a que já tem o id; senão a primeira (o time põe a mais nova à esquerda).
export function escolherGuia(cands: Guia[], idsPorGuia: Map<string, Set<string>>, leadId: string): Guia | null {
  if (!cands.length) return null;
  return cands.find((g) => idsPorGuia.get(g.titulo)?.has(leadId)) ?? cands[0];
}

// Cabeçalho = linha com "created_time" na 2ª coluna (mesma regra da sync-leads). Consultor: CONSULTOR, senão
// VENDEDOR/VENDEDORA/CONSULTORA, senão a coluna sem nome logo antes de STATUS (§60/§98).
export function lerCabecalho(valores: string[][]): Cabecalho | null {
  const i = valores.findIndex((r) => (r?.[1] ?? "").trim() === "created_time");
  if (i < 0) return null;
  const colunas = valores[i].map((c) => (c ?? "").trim());
  const achar = (nomes: string[]) => colunas.findIndex((c) => nomes.includes(norm(c)));
  const status = achar(["STATUS"]);
  let consultor = achar(["CONSULTOR"]);
  if (consultor < 0) consultor = achar(["VENDEDOR", "VENDEDORA", "CONSULTORA"]);
  if (consultor < 0 && status > 0 && colunas[status - 1] === "") consultor = status - 1;
  return { linha: i + 1, colunas, idx: { id: 0, consultor, status, obs: achar(["OBS"]), converteu: achar(["CONVERTEU?"]), receita: achar(["RECEITA"]) } };
}

export function idsDaGuia(valores: string[][], cab: Cabecalho): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = cab.linha; i < valores.length; i++) {
    const id = (valores[i]?.[cab.idx.id] ?? "").trim();
    if (id && !m.has(id)) m.set(id, i + 1);
  }
  return m;
}

export function colLetra(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const FMT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function formatarReceita(n: number | null): string {
  return n ? FMT.format(n) : "";
}

export function isoSP(iso: string | null): string {
  const t = Date.parse(iso || "");
  if (isNaN(t)) return "";
  return new Date(t - 3 * 3600000).toISOString().slice(0, 19) + "-03:00";
}

function aspas(titulo: string): string { return `'${titulo.replace(/'/g, "''")}'`; }

function valoresTrabalho(lead: LeadPlanilha): [keyof Indices, string][] {
  return [
    ["consultor", lead.consultor ?? ""],
    ["status", lead.status ?? ""],
    ["obs", lead.obs ?? ""],
    ["converteu", lead.converteu ? "sim" : ""],
    ["receita", formatarReceita(lead.receita)],
  ];
}

export function escritasDaLinha(titulo: string, cab: Cabecalho, linha: number, lead: LeadPlanilha): Escrita[] {
  return valoresTrabalho(lead)
    .filter(([k]) => cab.idx[k] >= 0)
    .map(([k, v]) => ({ range: `${aspas(titulo)}!${colLetra(cab.idx[k])}${linha}`, values: [[v]] }));
}

const CAMPOS_FORM: Record<string, keyof LeadPlanilha> = {
  ad_id: "ad_id", ad_name: "ad_name", adset_id: "adset_id", adset_name: "adset_name", campaign_id: "campaign_id",
  campaign_name: "campaign_name", form_id: "form_id", form_name: "form_name", is_organic: "is_organic", platform: "platform",
  "qual_o_tipo_da_sua_empresa?": "tipo_empresa", "qual_a_quantidade_de_linhas?": "qtd_linhas", "qual_o_seu_cnpj?": "cnpj",
  email: "email", full_name: "full_name", city: "city", state: "state", phone_number: "phone_number", lead_status: "lead_status",
};

export function linhaNova(cab: Cabecalho, lead: LeadPlanilha): string[] {
  const l = cab.colunas.map((c) => {
    if (c === "created_time") return isoSP(lead.criado_em_lead);
    const campo = CAMPOS_FORM[c];
    if (!campo) return "";
    const v = lead[campo];
    return v === null || v === undefined ? "" : String(v);
  });
  l[cab.idx.id] = lead.id;
  for (const [k, v] of valoresTrabalho(lead)) if (cab.idx[k] >= 0) l[cab.idx[k]] = v;
  return l;
}

// Guia de entrada → objetos para a RPC leads_entrada (só campos do formulário).
export function leadsDaEntrada(valores: string[][]): { leads: Record<string, unknown>[]; invalidos: number } {
  const cab = lerCabecalho(valores);
  if (!cab) throw new Error("cabeçalho não encontrado na guia de entrada (esperava 'created_time' na 2ª coluna)");
  const leads: Record<string, unknown>[] = [];
  let invalidos = 0;
  for (let i = cab.linha; i < valores.length; i++) {
    const r = valores[i] ?? [];
    const id = (r[cab.idx.id] ?? "").trim();
    if (!id) continue;
    const get = (nome: string) => { const j = cab.colunas.indexOf(nome); return j < 0 ? null : ((r[j] ?? "").trim() || null); };
    const criado = get("created_time");
    if (criado && isNaN(Date.parse(criado))) { invalidos++; continue; }
    const o: Record<string, unknown> = { id, criado_em_lead: criado };
    for (const [col, campo] of Object.entries(CAMPOS_FORM)) o[campo] = campo === "is_organic" ? (get(col) ?? "").toLowerCase() === "true" : get(col);
    leads.push(o);
  }
  return { leads, invalidos };
}
