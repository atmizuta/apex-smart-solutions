// Edge Function: planilha-espelho (§112). Chamada pelo pg_cron a cada 10 s com x-cron-secret (o mesmo SYNC_CRON_SECRET da
// sync-leads). Lê a guia de entrada do formulário → leads novos no banco; esvazia a fila leads_espelho → guia do mês.
// Corpo opcional: {"ensaio_aba":"OUTUBRO"} = ensaio a seco (calcula por guia, não escreve nada).
// Publicar: deploy_edge_function (index.ts, espelho.ts, planilha.ts, google.ts), verify_jwt=false. Secret: GOOGLE_SA_JSON.
import { createClient } from "npm:@supabase/supabase-js@2";
import { rodar } from "./espelho.ts";
import type { DepsEspelho, ItemFila } from "./espelho.ts";
import { criarSheets, obterToken } from "./google.ts";
import type { CfgPlanilha, LeadPlanilha } from "./planilha.ts";

const COLS = "aba,id,criado_em_lead,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,is_organic,platform,tipo_empresa,qtd_linhas,cnpj,email,full_name,city,state,phone_number,lead_status,consultor,status,obs,converteu,receita";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const agoraSP = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

Deno.serve(async (req) => {
  const segredo = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!segredo || !iguais(req.headers.get("x-cron-secret") ?? "", segredo)) return json({ error: "não autorizado" }, 401);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const corpo = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const falha = (ctx: string, error: { code?: string; message?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
    const cfgRows = await sb.from("config").select("chave,valor").in("chave", ["leads_modo", "leads_planilha"]);
    falha("ler config", cfgRows.error);
    const cfgMap = Object.fromEntries((cfgRows.data ?? []).map((r: { chave: string; valor: string }) => [r.chave, r.valor]));
    const cfg = JSON.parse(cfgMap.leads_planilha || "{}") as CfgPlanilha;
    if (!cfg.sheet_id) throw new Error("config.leads_planilha sem sheet_id");
    const sa = JSON.parse(Deno.env.get("GOOGLE_SA_JSON") || "{}");
    if (!sa.client_email || !sa.private_key) throw new Error("secret GOOGLE_SA_JSON ausente ou inválido");
    const token = await obterToken(sa, Math.floor(Date.now() / 1000), fetch);
    let token: string | null = null;
    const paraJson = (itens: ItemFila[], g: Record<string, string> = {}) =>
      itens.map((i) => ({ lead_aba: i.lead_aba, lead_id: i.lead_id, pedido_em: i.pedido_em, guia: g[`${i.lead_aba}|${i.lead_id}`] ?? "" }));
    const deps: DepsEspelho = {
      sheets: criarSheets(token, cfg.sheet_id, fetch),
      cfg,
      modo: cfgMap.leads_modo || "planilha",
      async pegarFila(limite) { const r = await sb.rpc("leads_espelho_pegar", { p_limite: limite }); falha("pegar fila", r.error); return r.data ?? []; },
      async leadsDaAba(aba) { const r = await sb.from("leads").select(COLS).eq("aba", aba).limit(5000); falha("ler leads da aba", r.error); return (r.data ?? []) as LeadPlanilha[]; },
      async buscarLeads(ch) {
        const out: LeadPlanilha[] = [];
        for (const aba of [...new Set(ch.map((c) => c.aba))]) {
          const ids = ch.filter((c) => c.aba === aba).map((c) => c.id);
          const r = await sb.from("leads").select(COLS).eq("aba", aba).in("id", ids);
          falha("ler leads da fila", r.error);
          out.push(...((r.data ?? []) as LeadPlanilha[]));
        }
        return out;
      },
      async marcarFeito(itens, g) { if (itens.length) falha("marcar feito", (await sb.rpc("leads_espelho_feito", { p_itens: paraJson(itens, g) })).error); },
      async marcarFalha(itens, erro) { if (itens.length) falha("marcar falha", (await sb.rpc("leads_espelho_falha", { p_itens: paraJson(itens), p_erro: erro })).error); },
      async adiar(itens, motivo) { if (itens.length) falha("adiar", (await sb.rpc("leads_espelho_adiar", { p_itens: paraJson(itens), p_motivo: motivo })).error); },
      async inserirEntrada(leads) { const r = await sb.rpc("leads_entrada", { p_leads: leads }); falha("gravar entrada", r.error); return r.data; },
      async registrarEntrada(erro) {
        const linhas = erro ? [{ chave: "leads_sync_erro", valor: `${agoraSP()} — ${erro}` }]
                            : [{ chave: "leads_atualizado_em", valor: agoraSP() }, { chave: "leads_sync_erro", valor: "" }];
        falha("registrar entrada", (await sb.from("config").upsert(linhas, { onConflict: "chave" })).error);
      },
      async atrasoMin() { const r = await sb.rpc("leads_espelho_atraso"); falha("atraso", r.error); return r.data === null ? null : Number(r.data); },
      async avisar(msg) { falha("aviso", (await sb.from("config").upsert({ chave: "leads_espelho_aviso", valor: msg }, { onConflict: "chave" })).error); },
      async travar() {
        const r = await sb.rpc("leads_espelho_travar", { p_segundos: 60 });
        falha("travar rodada", r.error);
        token = r.data ?? null;
        return token !== null;
      },
      async destravar() { if (token) falha("destravar rodada", (await sb.rpc("leads_espelho_destravar", { p_token: token })).error); },
      async idsExistentes(ids) {
        const achados = new Set<string>();
        for (let i = 0; i < ids.length; i += 200) {
          const r = await sb.from("leads").select("id").in("id", ids.slice(i, i + 200));
          falha("conferir ids", r.error);
          for (const x of (r.data ?? []) as { id: string }[]) achados.add(x.id);
        }
        return achados;
      },
    };
    const r = await rodar(deps, { ensaioAba: typeof corpo.ensaio_aba === "string" ? corpo.ensaio_aba : undefined });
    return json(r, 200);
  } catch (e) {
    // erro antes da rodada (secret, token do Google, config): sem isto a entrada de leads pararia em silêncio (revisão final)
    console.error("planilha-espelho:", (e as Error).message);
    await sb.from("config").upsert({ chave: "leads_sync_erro", valor: `${agoraSP()} — planilha-espelho: ${(e as Error).message}` }, { onConflict: "chave" })
      .then(() => null, () => null);
    return json({ error: (e as Error).message }, 500);
  }
});
