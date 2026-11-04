// Cliente mínimo da Graph API da Meta (§137). O token vai só no cabeçalho Authorization: nunca na URL nem no erro.
import type { LeadMeta } from "./converter.ts";

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;
export type FormMeta = { id: string; name: string; status: string };
export type Meta = {
  leadsDesde(formId: string, desdeSeg: number): Promise<LeadMeta[]>;
  nomeForm(formId: string): Promise<string | null>;
  forms(pageId: string): Promise<FormMeta[]>;
};

export const GRAPH_VERSAO = "v26.0";
export const MAX_PAGINAS = 50;
const API = `https://graph.facebook.com/${GRAPH_VERSAO}`;
const CAMPOS = "id,created_time,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,is_organic,platform,field_data";

export function criarMeta(token: string, f: FetchFn): Meta {
  async function chamar(url: string): Promise<Record<string, unknown>> {
    const r = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = await r.json().catch(() => ({})) as Record<string, unknown>;
    const err = corpo.error as { message?: string; code?: number } | undefined;
    if (!r.ok || err) {
      const msg = String(err?.message ?? "sem mensagem").split(token).join("…").slice(0, 160);
      throw new Error(`Graph ${r.status} (${err?.code ?? "?"}): ${msg}`);
    }
    return corpo;
  }
  async function paginar<T>(primeira: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = primeira;
    for (let p = 0; url; p++) {
      if (p >= MAX_PAGINAS) throw new Error(`Graph: mais de ${MAX_PAGINAS} páginas, parei`);
      const j = await chamar(url);
      out.push(...((j.data as T[]) ?? []));
      url = (j.paging as { next?: string } | undefined)?.next;
    }
    return out;
  }
  return {
    leadsDesde(formId, desdeSeg) {
      const q = new URLSearchParams({
        fields: CAMPOS,
        filtering: JSON.stringify([{ field: "time_created", operator: "GREATER_THAN", value: desdeSeg }]),
        limit: "100",
      });
      return paginar<LeadMeta>(`${API}/${encodeURIComponent(formId)}/leads?${q}`);
    },
    async nomeForm(formId) {
      const j = await chamar(`${API}/${encodeURIComponent(formId)}?fields=name`);
      return typeof j.name === "string" ? j.name : null;
    },
    forms(pageId) {
      return paginar<FormMeta>(`${API}/${encodeURIComponent(pageId)}/leadgen_forms?${new URLSearchParams({ fields: "id,name,status", limit: "100" })}`);
    },
  };
}
