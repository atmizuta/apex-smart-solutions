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
  const limpo = (s: string) => s.split(token).join("…").slice(0, 160);
  async function chamar(url: string): Promise<Record<string, unknown>> {
    let r: Response;
    try {
      r = await f(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      // erro de rede do Deno traz a URL: nunca deixar o token chegar ao status/aviso (revisão final)
      throw new Error(`Graph rede: ${limpo(String((e as Error)?.message ?? e))}`);
    }
    const corpo = await r.json().catch(() => ({})) as Record<string, unknown>;
    const err = corpo.error as { message?: string; code?: number } | undefined;
    if (!r.ok || err) throw new Error(`Graph ${r.status} (${err?.code ?? "?"}): ${limpo(String(err?.message ?? "sem mensagem"))}`);
    return corpo;
  }
  // a Graph pode pôr access_token no link "next": o token vai só no cabeçalho
  function semToken(next: string | undefined): string | undefined {
    if (!next) return undefined;
    const u = new URL(next);
    u.searchParams.delete("access_token");
    return u.toString();
  }
  async function paginar<T>(primeira: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | undefined = primeira;
    for (let p = 0; url; p++) {
      if (p >= MAX_PAGINAS) throw new Error(`Graph: mais de ${MAX_PAGINAS} páginas, parei`);
      const j = await chamar(url);
      out.push(...((j.data as T[]) ?? []));
      url = semToken((j.paging as { next?: string } | undefined)?.next);
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
