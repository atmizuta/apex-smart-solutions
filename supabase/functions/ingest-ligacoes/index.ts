// Edge Function: ingest-ligacoes — recebe do robô ProContact (Plano B) as linhas do relatório de Chamadas Manuais
// e grava em ligacoes_manuais (upsert por id) e em ligacoes_sync_log. Spec: docs/superpowers/specs/2026-10-01-robo-procontact-ligacoes-design.md
// Chamada só pelo robô (header x-robo-token = secret INGEST_LIGACOES_TOKEN); por isso roda sem JWT (--no-verify-jwt).
// Publicar: npx supabase functions deploy ingest-ligacoes --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./ingest.ts";
import type { DepsIngest } from "./ingest.ts";

const MAX_BYTES = 1_000_000;

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

function criarDeps(): DepsIngest {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  // a mensagem do PostgREST pode citar valores da linha; guardamos só o código e o contexto
  const falha = (ctx: string, error: { code?: string } | null) => { if (error) throw new Error(`${ctx} (código ${error.code ?? "?"})`); };
  return {
    async gravarLigacoes(linhas) {
      const { error } = await sb.from("ligacoes_manuais").upsert(linhas, { onConflict: "id" });
      falha("gravar ligações", error);
    },
    async gravarLog(l) {
      const { error } = await sb.from("ligacoes_sync_log").upsert(l, { onConflict: "execucao_id" });
      falha("gravar log da execução", error);
    },
    async contarPeriodo(de, ate) {
      const { count, error } = await sb.from("ligacoes_manuais").select("id", { count: "exact", head: true })
        .gte("gerada_em", de).lte("gerada_em", ate);
      falha("contar ligações", error);
      return count ?? 0;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  let esperado: string;
  try { esperado = env("INGEST_LIGACOES_TOKEN"); } catch { return json({ error: "Não autorizado" }, 401); }
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
