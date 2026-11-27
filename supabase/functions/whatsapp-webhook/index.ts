// Edge Function: whatsapp-webhook (§167). Recebe o webhook da Meta (Cloud API, coexistência), grava as mensagens e,
// fora do expediente, chama o agente depois de ~8 s (junta rajadas). Também atende o cron (x-cron-secret): tick de
// 1 min e limpeza diária. Spec: docs/superpowers/specs/2026-11-24-whatsapp-agente-noturno-design.md.
// Secrets: WA_TOKEN, WA_APP_SECRET, WA_VERIFY_TOKEN, WA_PHONE_ID, ANTHROPIC_API_KEY. Publicar com verify_jwt=false,
// levando junto ../verificar-cnpj/verificar.ts. Logs: só ids e códigos (repo e logs públicos).
import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";
import { assinaturaValida, lerPayload, verificacao } from "./recebimento.ts";
import type { Evento } from "./recebimento.ts";
import { atender } from "./agente.ts";
import type { DepsAgente, RespostaClaude } from "./agente.ts";
import { consultarFora } from "../verificar-cnpj/verificar.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const GRAPH = "https://graph.facebook.com/v23.0";   // confirmar a versão na etapa 0
const BUCKET = "wa-documentos";
const MAX_MIDIA = 10 * 1024 * 1024;
const ESPERA_RAJADA_MS = 8000;
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "application/pdf": "pdf", "audio/ogg": "ogg" };

const env = (k: string) => Deno.env.get(k) ?? "";
const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), timeout: 60_000, maxRetries: 1 })   // o agente já tenta de novo uma vez;
const log = (m: string) => console.log(`whatsapp-webhook: ${m}`);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function rpc<T>(nome: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await sb.rpc(nome, args);
  if (r.error) throw new Error(`${nome} (código ${r.error.code ?? "?"})`);
  return r.data as T;
}

async function graph(alvo: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(alvo.startsWith("https://") ? alvo : `${GRAPH}/${alvo}`, {
    ...init, headers: { Authorization: `Bearer ${env("WA_TOKEN")}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`graph HTTP ${r.status}`);
  return r;
}

// O link da mídia da Meta expira em ~5 min: baixa já, no próprio webhook. Acima de 10 MB não baixa.
async function baixarMidia(ev: Evento): Promise<{ caminho: string | null; mime: string | null }> {
  const info = await (await graph(ev.midia!.id)).json() as { url?: string; mime_type?: string; file_size?: number };
  const mime = String(info.mime_type ?? ev.midia!.mime).split(";")[0].trim();
  if (!info.url || Number(info.file_size ?? 0) > MAX_MIDIA) return { caminho: null, mime };
  const bytes = new Uint8Array(await (await graph(info.url)).arrayBuffer());
  if (bytes.length > MAX_MIDIA) return { caminho: null, mime };
  const caminho = `m/${ev.wamid.replace(/[^A-Za-z0-9._-]/g, "_")}.${EXT[mime] ?? "bin"}`;
  const up = await sb.storage.from(BUCKET).upload(caminho, bytes, { contentType: mime, upsert: true });
  if (up.error) throw new Error("subir mídia no bucket");
  return { caminho, mime };
}

async function buscarJson(url: string, ms: number) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
  let corpo: unknown = null;
  try { corpo = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, corpo };
}

function depsAgente(): DepsAgente {
  return {
    contexto: (c) => rpc("wa_contexto", { p_conversa: c }),
    travar: (c) => rpc("wa_travar", { p_conversa: c }),
    liberar: async (c) => { await rpc("wa_liberar", { p_conversa: c }); },
    adiar: async (c) => { await rpc("wa_adiar", { p_conversa: c }); },
    avisouFalha: async (c) => { await rpc("wa_avisou_falha", { p_conversa: c }); },
    claude: async (pedido) => await anthropic.beta.messages.create(pedido as never) as unknown as RespostaClaude,
    midiaBase64: async (caminho) => {
      const r = await sb.storage.from(BUCKET).download(caminho);
      if (r.error || !r.data) throw new Error("baixar mídia do bucket");
      return encodeBase64(new Uint8Array(await r.data.arrayBuffer()));
    },
    salvar: async (c, s) => {
      await rpc("wa_salvar", { p_conversa: c, p_ficha: s.ficha ?? null, p_alertas: s.alertas ?? null, p_estado: s.estado ?? null, p_motivo: s.motivo ?? null });
    },
    situacaoCnpj: async (cnpj) => {
      const r = await consultarFora(cnpj, { buscar: buscarJson, log: (m) => log(`cnpj: ${m}`) });
      return r && r !== "invalido" ? r.situacao : null;
    },
    noExpediente: () => rpc("wa_no_expediente"),
    ultimaDoCliente: (c) => rpc("wa_ultima_do_cliente", { p_conversa: c }),
    enviar: async (telefone, texto) => {
      const r = await graph(`${env("WA_PHONE_ID")}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: telefone, type: "text", text: { body: texto } }),
      });
      const j = await r.json() as { messages?: { id?: string }[] };
      const id = j.messages?.[0]?.id;
      if (!id) throw new Error("envio sem id");
      return id;
    },
    registrarEnvio: async (c, wamid, texto, formato) => { await rpc("wa_registrar_envio", { p_conversa: c, p_wamid: wamid, p_texto: texto, p_formato: formato }); },
    aviso: async (chave, valor) => { await rpc("wa_aviso", { p_chave: chave, p_valor: valor }); },
    ms: () => Date.now(),
    log,
  };
}

async function atenderSeguro(conversa: string, esperado?: string) {
  try { log(`conversa ${conversa}: ${await atender(conversa, depsAgente(), esperado)}`); }
  catch (e) { log(`conversa ${conversa} falhou: ${(e as Error).message}`); }   // a trava expira em 5 min; o tick tenta de novo
}

async function tick() {
  const t = await rpc<{ pendentes: string[] }>("wa_tick");
  await Promise.all((t.pendentes ?? []).map((c) => atenderSeguro(c)));   // em paralelo: 5 em série estourariam o limite de tempo da função
}

async function limpar() {
  const caminhos = await rpc<string[]>("wa_limpar_lista");
  for (let i = 0; i < caminhos.length; i += 100) {
    const r = await sb.storage.from(BUCKET).remove(caminhos.slice(i, i + 100));
    if (r.error) throw new Error("apagar mídias antigas");
  }
  log(`limpeza: ${caminhos.length} arquivos, ${await rpc<number>("wa_limpar")} mensagens`);
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") {
      const ch = verificacao(new URL(req.url).searchParams, env("WA_VERIFY_TOKEN"));
      return ch === null ? new Response("proibido", { status: 403 }) : new Response(ch, { status: 200 });
    }
    if (req.method !== "POST") return new Response("use POST", { status: 405 });

    const segredoCron = req.headers.get("x-cron-secret");
    if (segredoCron !== null) {
      if (!(await rpc<boolean>("wa_cron_confere", { p_token: segredoCron }))) return new Response("não autorizado", { status: 401 });
      const { acao } = await req.json().catch(() => ({})) as { acao?: string };
      const fazer = (p: Promise<unknown>) => typeof EdgeRuntime !== "undefined" ? EdgeRuntime.waitUntil(p) : p;
      if (acao === "tick") await fazer(tick());   // responde 200 na hora; o pg_net desiste em 5 s
      else if (acao === "limpar") await limpar();
      else return new Response("ação desconhecida", { status: 400 });
      return new Response("ok");
    }

    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!(await assinaturaValida(bytes, req.headers.get("x-hub-signature-256"), env("WA_APP_SECRET")))) {
      log("assinatura inválida (401)");
      return new Response("assinatura inválida", { status: 401 });
    }
    let corpo: unknown = null;
    try { corpo = JSON.parse(new TextDecoder().decode(bytes)); } catch { /* corpo inválido: nenhum evento */ }
    const linhas: Record<string, unknown>[] = [];
    for (const ev of lerPayload(corpo)) {
      let caminho: string | null = null, mime: string | null = ev.midia?.mime ?? null;
      if (ev.tipo === "cliente" && ev.midia) {
        try { ({ caminho, mime } = await baixarMidia(ev)); } catch (e) { log(`mídia ${ev.wamid}: ${(e as Error).message}`); }
      }
      linhas.push({ tipo: ev.tipo, wamid: ev.wamid, telefone: ev.telefone, nome_perfil: ev.nome_perfil, em: ev.em,
        formato: ev.formato, texto: ev.texto, caminho, mime, nome_arquivo: ev.midia?.nome ?? null });
    }
    const novas = linhas.length ? await rpc<{ conversa_id: string; wamid: string }[]>("wa_receber", { p_eventos: linhas }) : [];
    if (novas.length) {
      const trabalho = (async () => {
        await esperar(ESPERA_RAJADA_MS);
        for (const n of novas) await atenderSeguro(n.conversa_id, n.wamid);
      })();
      if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabalho); else await trabalho;
    }
    return new Response("ok");   // 200 só depois de gravar: falha antes disso = a Meta reenvia
  } catch (e) {
    log(`falha (500): ${(e as Error).message}`);
    return new Response("falha temporária", { status: 500 });
  }
});
