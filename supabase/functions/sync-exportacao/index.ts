// Edge Function: sync-exportacao — categoria da venda perdida (API do Relatório de Exportação Xeotech) em
// producao_atividades, 1 linha por pedido. Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md
// Chamada só pelo pg_cron (header x-cron-secret); sem JWT. Token da API: secret NEO_EXPORT_TOKEN (nunca em log/resposta).
// Corpo opcional {"modo":"teste"}: faz tudo menos gravar e devolve só contagens.
import { createClient } from "npm:@supabase/supabase-js@2";
import { agruparPorPedido, mensagemErro, ocultarToken, periodoConsulta } from "./exportacao.ts";

const API = "https://api.xeotech.com.br/api/v1/producao/exportacao/";
const PAINEL_ID = 15455;
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
  let corpo: { modo?: string } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const teste = corpo.modo === "teste";
  const token = Deno.env.get("NEO_EXPORT_TOKEN") ?? "";
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"));

  let logId: number | null = null;
  if (!teste) {
    const { data } = await admin.from("exportacao_sync_log").insert({}).select("id").single();
    logId = (data as { id: number } | null)?.id ?? null;
  }
  const fechar = async (campos: Record<string, unknown>) => {
    if (logId !== null) await admin.from("exportacao_sync_log").update({ ...campos, terminou_em: new Date().toISOString() }).eq("id", logId);
  };

  try {
    if (!token) throw new Error("Secret NEO_EXPORT_TOKEN ausente.");
    const periodo = periodoConsulta(Date.now());
    const resp = await fetch(API + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ painelId: PAINEL_ID, ...periodo, formato: "json" }),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = ocultarToken(mensagemErro(resp.status, texto, resp.headers.get("Retry-After")), token);
      await fechar({ ok: false, http: resp.status, erro });
      return json({ ok: false, erro }, 502);
    }
    let j: { dados?: unknown };
    try {
      j = JSON.parse(texto) as { dados?: unknown };
    } catch {
      throw new Error("Resposta da API não é JSON: " + texto.slice(0, 200));
    }
    if (!Array.isArray(j.dados)) throw new Error(mensagemErro(resp.status, texto, null));
    const linhas = j.dados as Record<string, unknown>[];
    if (linhas.length === 0) throw new Error("A API devolveu 0 linhas para o painel 15455 — nada foi gravado.");
    const pedidos = agruparPorPedido(linhas);
    if (teste) return json({ ok: true, teste: true, linhas: linhas.length, pedidos: pedidos.length, comCategoria: pedidos.filter((p) => p.categoria).length }, 200);
    let gravados = 0;
    const agora = new Date().toISOString();
    for (let i = 0; i < pedidos.length; i += LOTE) {
      const lote = pedidos.slice(i, i + LOTE).map((p) => ({ ...p, sincronizado_em: agora }));
      const { error } = await admin.from("producao_atividades").upsert(lote, { onConflict: "numero_pedido" });
      if (error) throw new Error("Erro ao gravar producao_atividades: " + error.message);
      gravados += lote.length;
    }
    await fechar({ ok: true, http: resp.status, linhas: linhas.length, pedidos: pedidos.length, gravados });
    return json({ ok: true, linhas: linhas.length, pedidos: pedidos.length, gravados }, 200);
  } catch (e) {
    const erro = ocultarToken(String((e as Error)?.message ?? e), token).slice(0, 500);
    await fechar({ ok: false, erro });
    return json({ ok: false, erro }, 500);
  }
});
