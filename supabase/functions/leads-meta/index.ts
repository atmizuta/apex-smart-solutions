// Edge Function: leads-meta (§137). Chamada pelo pg_cron a cada 1 min com x-cron-secret (o mesmo SYNC_CRON_SECRET da
// sync-leads e da planilha-espelho). Busca os leads do formulário na Graph API da Meta e grava pela leads_entrada2.
// Modo em config.leads_meta (desligado | ensaio | paralelo | principal); status em config.leads_meta_status.
// Publicar: deploy_edge_function (index.ts, rodada.ts, meta.ts, converter.ts), verify_jwt=false. Secret: META_PAGE_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2";
import { rodar } from "./rodada.ts";
import type { CfgMeta, DepsMeta, StatusMeta } from "./rodada.ts";
import { criarMeta } from "./meta.ts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const segredo = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!segredo || !iguais(req.headers.get("x-cron-secret") ?? "", segredo)) return json({ error: "não autorizado" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const falha = (ctx: string, error: { code?: string; message?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  let status: StatusMeta = {};
  try {
    const rows = await sb.from("config").select("chave,valor").in("chave", ["leads_meta", "leads_meta_status"]);
    falha("ler config", rows.error);
    const m = Object.fromEntries((rows.data ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor]));
    const cfg = JSON.parse(m.leads_meta || "{}") as CfgMeta;
    status = JSON.parse(m.leads_meta_status || "{}") as StatusMeta;
    if (!["ensaio", "paralelo", "principal"].includes(cfg.modo)) return json({ ok: true, modo: cfg.modo ?? "desligado" }, 200);
    const token = Deno.env.get("META_PAGE_TOKEN") ?? "";
    if (!token) throw new Error("secret META_PAGE_TOKEN ausente");
    if (!cfg.page_id || !Array.isArray(cfg.form_ids) || !cfg.form_ids.length) throw new Error("config.leads_meta sem page_id ou form_ids");
    const deps: DepsMeta = {
      meta: criarMeta(token, fetch),
      cfg, status, agora: new Date(),
      async idsExistentes(ids) {
        const achados = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const r = await sb.from("leads").select("id").in("id", ids.slice(i, i + 200));
          falha("conferir ids", r.error);
          for (const x of (r.data ?? []) as { id: string }[]) achados.add(x.id);
        }
        return achados;
      },
      async inserir(leads, espelho) {
        const r = await sb.rpc("leads_entrada2", { p_leads: leads, p_espelho: espelho, p_origem: "meta" });
        falha("gravar leads", r.error);
        return { inseridos: Number(r.data?.inseridos ?? 0), vistos: Number(r.data?.vistos ?? 0) };
      },
      async salvarCursor(iso) { falha("gravar cursor", (await sb.rpc("leads_meta_cursor", { p_cursor: iso })).error); },
      async salvarStatus(s) {
        falha("gravar status", (await sb.from("config").upsert({ chave: "leads_meta_status", valor: JSON.stringify(s) }, { onConflict: "chave" })).error);
      },
    };
    const r = await rodar(deps);
    return json(r, 200);
  } catch (e) {
    // erro antes da rodada (config, secret): sem isto a busca pararia em silêncio
    const erro = (e as Error).message;
    console.error("leads-meta:", erro);
    await sb.from("config").upsert({ chave: "leads_meta_status", valor: JSON.stringify({ ...status, ultimo_erro: erro, erro_em: new Date().toISOString() }) }, { onConflict: "chave" })
      .then(() => null, () => null);
    return json({ error: erro }, 500);
  }
});
