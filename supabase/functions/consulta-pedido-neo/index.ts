// Edge Function: consulta-pedido-neo — §170. Consulta Pedido da Xeotech, sob demanda, pela gaveta do pedido.
// Spec: docs/superpowers/specs/2026-11-27-consulta-pedido-design.md. Publicar com verify_jwt = true.
// Corpo {numero}. Permissão e vaga: RPC consulta_pedido_preparar, rodada com o login de quem clicou.
// Token: secret NEO_PEDIDOS_TOKEN; vai na URL, então nunca entra em log nem resposta.
// Responde sempre 200 com {ok, erro?}: o painel lê a mensagem sem tratar status.
import { createClient } from "npm:@supabase/supabase-js@2";
import { erroSeguro, mensagemErro, mensagemRecusa, mensagemUsuario, ocultarToken, recortar } from "./consulta.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
type Prep = { ok?: boolean; motivo?: string; espera_s?: number; log_id?: number; pedido_id?: number };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, erro: "Método não permitido." }, 405);
  let corpo: { numero?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const numero = String(corpo.numero ?? "").trim();
  if (!/^[\w.-]{1,40}$/.test(numero)) return json({ ok: false, erro: "Número de pedido inválido." });

  const comoUsuario = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  const { data, error } = await comoUsuario.rpc("consulta_pedido_preparar", { p_numero: numero });
  if (error) return json({ ok: false, erro: "Não foi possível conferir sua permissão. Entre de novo no painel." });
  const p = (data ?? {}) as Prep;
  if (!p.ok) return json({ ok: false, erro: mensagemRecusa(p) });

  const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
  const token = Deno.env.get("NEO_PEDIDOS_TOKEN") ?? "";
  const fechar = (campos: Record<string, unknown>) =>
    admin.from("neo_consulta_log").update({ ...campos, terminou_em: new Date().toISOString() }).eq("id", p.log_id);
  try {
    if (!token) throw new Error("Secret NEO_PEDIDOS_TOKEN ausente.");
    const resp = await fetch(`https://api.xeotech.com.br/api/v1/pedidos/${p.pedido_id}/${encodeURIComponent(token)}`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000),
    });
    const texto = await resp.text();
    const retry = resp.headers.get("Retry-After");
    if (!resp.ok) {
      await fechar({ ok: false, http: resp.status, erro: ocultarToken(mensagemErro(resp.status, texto, retry), token) });
      return json({ ok: false, erro: mensagemUsuario(resp.status, retry) });
    }
    let j: { codigo?: unknown } | null;
    try { j = JSON.parse(texto); } catch { throw new Error(`Resposta não é JSON (HTTP ${resp.status}).`); }
    const r = recortar(j);
    // sem etapa = não veio um pedido; o corpo só vai ao log se for o {codigo, mensagem} da Xeotech (pedido pode ter CPF)
    if (!r.etapa_neo) throw new Error(j?.codigo ? mensagemErro(resp.status, texto, null) : `Resposta sem etapa (HTTP ${resp.status}).`);
    const { data: salvo, error: eSalvar } = await admin.rpc("consulta_pedido_salvar", {
      p_log_id: p.log_id, p_etapa_neo: r.etapa_neo, p_resumo: r.resumo, p_itens: r.itens,
    });
    if (eSalvar) throw new Error("Erro ao gravar a consulta: " + eSalvar.message);
    return json({ ok: true, ...(salvo as Record<string, unknown>) });
  } catch (e) {
    await fechar({ ok: false, erro: erroSeguro(e, token) });
    return json({ ok: false, erro: mensagemUsuario(0, null) });
  }
});
