// Edge Function: sync-pedidos-neo — §166. Movimentação (filme por etapa) e Atualizações (diário de anotações) da Xeotech.
// Spec: docs/superpowers/specs/2026-11-24-movimentacoes-pedidos-design.md
// Chamada só pelo pg_cron (x-cron-secret). Token: secret NEO_PEDIDOS_TOKEN (nunca em log/resposta).
// Corpo {"api":"atualizacoes"|"movimentacao"}; {"modo":"teste"} faz tudo menos gravar e devolve só contagens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type Api, corpoDaApi, erroSeguro, linhasAnotacao, linhasFilme, mensagemErro, ocultarToken, proximaJanela } from "./pedidos.ts";

const URL_API: Record<Api, string> = {
  movimentacao: "https://api.xeotech.com.br/api/v1/pedidos/movimentacao/",
  atualizacoes: "https://api.xeotech.com.br/api/v1/pedidos/atualizacoes/",
};
const LOTE = 500;

function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
}
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
  const cronSecret = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!cronSecret || !iguais(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Não autorizado." }, 401);
  let corpo: { api?: string; modo?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const api: Api | null = corpo.api === "movimentacao" || corpo.api === "atualizacoes" ? corpo.api : null;
  if (!api) return json({ error: "Informe api: movimentacao ou atualizacoes." }, 400);
  const teste = corpo.modo === "teste";
  const token = Deno.env.get("NEO_PEDIDOS_TOKEN") ?? "";
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  const { data: ult, error: eUlt } = await admin.from("neo_pedidos_sync_log").select("janela_fim")
    .eq("api", api).eq("ok", true).order("janela_fim", { ascending: false }).limit(1).maybeSingle();
  // sem a última janela não dá para saber de onde seguir: cair no "última 1 h" pularia dados para sempre
  if (eUlt) return json({ ok: false, erro: "não foi possível ler o log da sincronização" }, 500);
  const janela = proximaJanela(api, ult?.janela_fim ? Date.parse(ult.janela_fim as string) : null, Date.now());
  if (!janela) return json({ ok: true, nada: true }, 200);

  let logId: number | null = null;
  if (!teste) {
    const { data } = await admin.from("neo_pedidos_sync_log")
      .insert({ api, janela_ini: new Date(janela.ini).toISOString(), janela_fim: new Date(janela.fim).toISOString() }).select("id").single();
    logId = (data as { id: number } | null)?.id ?? null;
  }
  const fechar = async (campos: Record<string, unknown>) => {
    if (logId !== null) await admin.from("neo_pedidos_sync_log").update({ ...campos, terminou_em: new Date().toISOString() }).eq("id", logId);
  };

  try {
    if (!token) throw new Error("Secret NEO_PEDIDOS_TOKEN ausente.");
    const resp = await fetch(URL_API[api] + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(corpoDaApi(api, janela)),
      signal: AbortSignal.timeout(100_000),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = ocultarToken(mensagemErro(resp.status, texto, resp.headers.get("Retry-After")), token);
      await fechar({ ok: false, http: resp.status, erro });
      return json({ ok: false, erro }, 502);
    }
    let j: { dados?: unknown };
    try { j = JSON.parse(texto); } catch { throw new Error(`Resposta da API não é JSON (HTTP ${resp.status}).`); }
    if (!Array.isArray(j?.dados)) throw new Error(mensagemErro(resp.status, texto, null)); // HTTP 200 com erro no corpo
    const linhas = j.dados as Record<string, unknown>[];
    let gravados = 0;
    if (api === "movimentacao") {
      const filme = linhasFilme(linhas);
      if (teste) return json({ ok: true, teste: true, api, linhas: linhas.length, gravar: filme.length }, 200);
      const agora = new Date().toISOString();
      for (let i = 0; i < filme.length; i += LOTE) {
        const lote = filme.slice(i, i + LOTE).map((l) => ({ ...l, sincronizado_em: agora }));
        const { error } = await admin.from("pedido_movimentacoes").upsert(lote, { onConflict: "pedido_id,etapa_id,entrou_em" });
        if (error) throw new Error("Erro ao gravar pedido_movimentacoes: " + error.message);
        gravados += lote.length;
      }
    } else {
      const notas = linhasAnotacao(linhas);
      if (teste) return json({ ok: true, teste: true, api, linhas: linhas.length, gravar: notas.length }, 200);
      const { data, error } = await admin.rpc("pedido_anotacoes_gravar", { p_linhas: notas });
      if (error) throw new Error("Erro ao gravar pedido_anotacoes: " + error.message);
      gravados = (data as number | null) ?? 0;
    }
    await fechar({ ok: true, http: resp.status, linhas: linhas.length, gravados });
    return json({ ok: true, api, linhas: linhas.length, gravados }, 200);
  } catch (e) {
    const erro = erroSeguro(e, token);
    await fechar({ ok: false, erro });
    return json({ ok: false, erro }, 500);
  }
});
