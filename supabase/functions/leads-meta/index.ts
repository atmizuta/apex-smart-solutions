// Edge Function: leads-meta (§137). Webhook que RECEBE os leads do formulário da Meta, enviados pela agência
// (Connect Max) com Authorization: Bearer <LEADS_WEBHOOK_TOKEN>. Grava pela leads_entrada2 e registra cada lead
// em leads_webhook_log (sem dado pessoal). Modo em config.leads_meta (desligado | ensaio | paralelo | principal).
// Publicar: deploy_edge_function (index.ts, recebimento.ts, converter.ts), verify_jwt=false. Secret: LEADS_WEBHOOK_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2";
import { receber } from "./recebimento.ts";
import type { DepsReceb, Modo } from "./recebimento.ts";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const falha = (ctx: string, error: { code?: string; message?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  const registrarErro = async (msg: string) => { falha("registrar erro", (await sb.rpc("leads_meta_erro", { p_msg: msg })).error); };
  try {
    const cfg = await sb.from("config").select("valor").eq("chave", "leads_meta").maybeSingle();
    falha("ler config", cfg.error);
    let modo: Modo = "desligado";
    try { modo = (JSON.parse(cfg.data?.valor || "{}").modo ?? "desligado") as Modo; } catch { /* JSON errado: fica desligado (503) e o aviso mostra */ }
    const deps: DepsReceb = {
      token: Deno.env.get("LEADS_WEBHOOK_TOKEN") ?? "",
      modo,
      async idsExistentes(ids) {
        const r = await sb.from("leads").select("id").in("id", ids);
        falha("conferir ids", r.error);
        return new Set(((r.data ?? []) as { id: string }[]).map((x) => x.id));
      },
      async inserir(leads, espelho) {
        const r = await sb.rpc("leads_entrada2", { p_leads: leads, p_espelho: espelho, p_origem: "meta" });
        falha("gravar leads", r.error);
        return { inseridos: Number(r.data?.inseridos ?? 0), vistos: Number(r.data?.vistos ?? 0) };
      },
      async registrar(itens, campos) { falha("registrar", (await sb.rpc("leads_meta_registrar", { p_itens: itens, p_campos: campos })).error); },
      registrarErro,
    };
    const r = await receber({ metodo: req.method, auth: req.headers.get("authorization"), corpo: req.method === "POST" ? await req.text() : "" }, deps);
    return json(r.corpo, r.status);
  } catch (e) {
    const msg = (e as Error).message;
    console.error("leads-meta:", msg);
    await registrarErro(`falha antes de receber (500): ${msg}`).catch(() => null);
    return json({ error: "falha temporária; reenviar" }, 500);
  }
});
