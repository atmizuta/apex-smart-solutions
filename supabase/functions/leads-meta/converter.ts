// Lead da Graph API da Meta → objeto da RPC leads_entrada2, no mesmo formato que a planilha grava (§137).
// Sem rede e sem Deno: testado com `node --test`.
export type CampoMeta = { name: string; values?: string[] };
export type LeadMeta = {
  id: string; created_time: string | number; form_name?: string; ad_id?: string; ad_name?: string; adset_id?: string; adset_name?: string;
  campaign_id?: string; campaign_name?: string; form_id?: string; is_organic?: boolean; platform?: string; field_data?: CampoMeta[];
};
export type LeadEntrada = {
  id: string; criado_em_lead: string; ad_id: string | null; ad_name: string | null; adset_id: string | null; adset_name: string | null;
  campaign_id: string | null; campaign_name: string | null; form_id: string | null; form_name: string | null; is_organic: boolean;
  platform: string | null; tipo_empresa: string | null; qtd_linhas: string | null; cnpj: string | null; email: string | null;
  full_name: string | null; city: string | null; state: string | null; phone_number: string | null; lead_status: string;
};
type CampoPergunta = "tipo_empresa" | "qtd_linhas" | "cnpj" | "email" | "full_name" | "city" | "state" | "phone_number";

// Nome da pergunta (sem "?", minúsculo) → campo. Os nomes são os do cabeçalho da planilha (o ensaio confirma).
const PERGUNTAS: Record<string, CampoPergunta> = {
  qual_o_tipo_da_sua_empresa: "tipo_empresa", qual_a_quantidade_de_linhas: "qtd_linhas", qual_o_seu_cnpj: "cnpj",
  email: "email", full_name: "full_name", city: "city", state: "state", phone_number: "phone_number",
};
const MESES = ["JANEIRO", "FEVEREIRO", "MARCO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];

const normPergunta = (s: string) => s.trim().toLowerCase().replace(/\?+$/, "");
const vazio = (s: string | undefined | null) => (s ?? "").trim() === "";
function prefixo(p: string, v: string | undefined | null): string | null {
  if (vazio(v)) return null;
  const t = v!.trim();
  return t.startsWith(p) ? t : p + t;
}

// A Graph API manda "+0000" (sem dois-pontos); a planilha, "-05:00". Devolve ISO UTC ou null.
export function horaIso(s: string | number): string | null {
  const bruto = String(s ?? "").trim();
  // ferramentas de integração costumam mandar a hora em segundos (ou ms) desde 1970
  if (/^\d{10}$/.test(bruto)) return new Date(Number(bruto) * 1000).toISOString();
  if (/^\d{13}$/.test(bruto)) return new Date(Number(bruto)).toISOString();
  const t = bruto.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const ms = Date.parse(t);
  return isNaN(ms) ? null : new Date(ms).toISOString();
}

// Igual a public.leads_mes_aba: mês do horário de São Paulo.
export function mesAba(iso: string): string {
  const mes = Number(new Date(iso).toLocaleString("en-US", { timeZone: "America/Sao_Paulo", month: "numeric" }));
  return MESES[mes - 1];
}

export function converter(l: LeadMeta, formName: string | null): { lead: LeadEntrada | null; desconhecidos: string[] } {
  const desconhecidos: string[] = [];
  const criado = horaIso(l.created_time);
  if (vazio(l.id) || !criado) return { lead: null, desconhecidos };
  const perguntas: Partial<Record<CampoPergunta, string | null>> = {};
  for (const c of l.field_data ?? []) {
    const campo = PERGUNTAS[normPergunta(c.name)];
    if (!campo) { desconhecidos.push(c.name); continue; }
    const v = (c.values ?? [])[0];
    perguntas[campo] = vazio(v) ? null : v.trim();
  }
  const lead: LeadEntrada = {
    id: prefixo("l:", l.id)!, criado_em_lead: criado,
    ad_id: prefixo("ag:", l.ad_id), ad_name: vazio(l.ad_name) ? null : l.ad_name!,
    adset_id: prefixo("as:", l.adset_id), adset_name: vazio(l.adset_name) ? null : l.adset_name!,
    campaign_id: prefixo("c:", l.campaign_id), campaign_name: vazio(l.campaign_name) ? null : l.campaign_name!,
    form_id: prefixo("f:", l.form_id), form_name: !vazio(formName) ? formName : vazio(l.form_name) ? null : l.form_name!.trim(),
    is_organic: l.is_organic === true, platform: vazio(l.platform) ? null : l.platform!,
    tipo_empresa: perguntas.tipo_empresa ?? null, qtd_linhas: perguntas.qtd_linhas ?? null, cnpj: perguntas.cnpj ?? null,
    email: perguntas.email ?? null, full_name: perguntas.full_name ?? null, city: perguntas.city ?? null, state: perguntas.state ?? null,
    phone_number: prefixo("p:", perguntas.phone_number), lead_status: "CREATED",
  };
  return { lead, desconhecidos };
}
