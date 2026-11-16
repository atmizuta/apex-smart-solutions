// Edge Function: ingest-socios — fila da consulta de sócios na Nova Vida (§155). Chamada só pelo robô
// (header x-robo-token = secret INGEST_SOCIOS_TOKEN); por isso roda sem JWT (--no-verify-jwt).
// Spec: docs/superpowers/specs/2026-11-16-consulta-socios-renovacao-design.md (4.6)
// Publicar: npx supabase functions deploy ingest-socios --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./ingest.ts";
import type { DepsSocios } from "./ingest.ts";

const MAX_BYTES = 200_000;

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

function criarDeps(): DepsSocios {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // a mensagem do PostgREST pode citar valores; guardamos só o código e o contexto
  const falha = (ctx: string, error: { code?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  return {
    async pegar(max) {
      const { data, error } = await sb.rpc("socios_robo_pegar", { p_max: max });
      falha("pegar pedidos", error);
      return (data ?? []) as { id: number; cnpj: string }[];
    },
    async concluir(id, patch) {
      const { data, error } = await sb.from("socios_consultas")
        .update({ ...patch, concluido_em: new Date().toISOString() })
        .eq("id", id).eq("status", "consultando").select("id");
      falha("gravar resultado", error);
      return (data ?? []).length === 1;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let esperado: string;
  try { esperado = env("INGEST_SOCIOS_TOKEN"); } catch { return json({ error: "Não autorizado" }, 401); }
  const recebido = req.headers.get("x-robo-token") ?? "";
  if (!recebido || !iguais(recebido, esperado)) return json({ error: "Não autorizado" }, 401);

  const declarado = Number(req.headers.get("content-length") ?? 0);
  if (declarado > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  const texto = await req.text();
  if (texto.length > MAX_BYTES) return json({ error: "corpo grande demais" }, 413);
  let corpo: unknown;
  try { corpo = JSON.parse(texto); } catch { return json({ error: "JSON inválido" }, 400); }

  const r = await processar(corpo, criarDeps());
  return json(r.corpo, r.status);
});
