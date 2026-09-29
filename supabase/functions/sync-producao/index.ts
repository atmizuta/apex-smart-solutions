// Edge Function: sync-producao — espelha a produção do NeoCRM (API NeoSales) em producao_pedidos_neo.
// Chamada só pelo pg_cron (header x-cron-secret); por isso roda sem JWT (--no-verify-jwt).
// Publicar: cd crm && npx supabase functions deploy sync-producao --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { executarSync } from "./sync.ts";
import type { Deps } from "./sync.ts";
import { criarBuscarNeo } from "./neosales.ts";
import { formatoPainel, parseFormatoNeo } from "./windows.ts";
import type { Modo } from "./windows.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const MODOS: Modo[] = ["horario", "reconciliar", "backfill", "manual"];
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
function lotes<T>(xs: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += LOTE) out.push(xs.slice(i, i + LOTE));
  return out;
}

function criarDeps(): Deps {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const buscarNeo = criarBuscarNeo({
    url: Deno.env.get("NEOSALES_URL") ?? "https://apex.neosales.com.br/producao-painel-integration-v2",
    tokenEstrutura: env("NEOSALES_TOKEN_ESTRUTURA"),
    tokenUsuario: env("NEOSALES_TOKEN_USUARIO"),
    painelId: env("NEOSALES_PAINEL_ID"),
  });
  const falha = (ctx: string, error: { message: string } | null) => { if (error) throw new Error(`${ctx}: ${error.message}`); };

  return {
    agora: () => new Date(),
    buscarNeo,
    async ultimoCursor() {
      const { data, error } = await sb.from("producao_sync_log").select("janela_fim")
        .eq("ok", true).neq("modo", "manual").order("janela_fim", { ascending: false }).limit(1);
      falha("ler cursor", error);
      return data && data.length > 0 && data[0].janela_fim ? new Date(data[0].janela_fim) : null;
    },
    async gravar(itens) {
      const agora = new Date().toISOString();
      for (const lote of lotes(itens)) {
        const a = await sb.from("producao_pedidos_neo")
          .upsert(lote.map((i) => ({ ...i.reg, sincronizado_em: agora })), { onConflict: "item_id" });
        falha("gravar pedidos", a.error);
        const b = await sb.from("producao_neo_raw")
          .upsert(lote.map((i) => ({ item_id: i.reg.item_id, raw: i.raw, sincronizado_em: agora })), { onConflict: "item_id" });
        falha("gravar raw", b.error);
      }
    },
    async remover(ids) {
      for (const lote of lotes(ids)) {
        const a = await sb.from("producao_pedidos_neo").delete().in("item_id", lote);
        falha("remover pedidos", a.error);
        const b = await sb.from("producao_neo_raw").delete().in("item_id", lote);
        falha("remover raw", b.error);
      }
    },
    async abrirLog(modo, ini, fim, observacao) {
      const { data, error } = await sb.from("producao_sync_log")
        .insert({ modo, janela_ini: ini.toISOString(), janela_fim: fim.toISOString(), observacao }).select("id").single();
      falha("abrir log", error);
      return data!.id as number;
    },
    async fecharLog(id, r) {
      const { error } = await sb.from("producao_sync_log").update({
        terminou_em: new Date().toISOString(), ok: r.ok, linhas_api: r.linhasApi, gravadas: r.gravadas,
        removidas: r.removidas, descartes: r.descartes, erro: r.erro,
      }).eq("id", id);
      falha("fechar log", error);
    },
    async marcarAtualizado(quando) {
      const { error } = await sb.from("config").upsert(
        { chave: "producao_neo_atualizado_em", valor: formatoPainel(quando), atualizado_em: quando.toISOString() },
        { onConflict: "chave" },
      );
      falha("carimbar atualização", error);
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!iguais(req.headers.get("x-cron-secret") ?? "", env("SYNC_CRON_SECRET"))) return json({ error: "Não autorizado" }, 401);

  let corpo: { modo?: string; inicio?: string; fim?: string };
  try { corpo = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const modo = corpo.modo as Modo;
  if (!MODOS.includes(modo)) return json({ error: `modo deve ser um de: ${MODOS.join(", ")}` }, 400);

  let inicio: Date | undefined, fim: Date | undefined;
  try {
    inicio = corpo.inicio ? parseFormatoNeo(corpo.inicio) : undefined;
    fim = corpo.fim ? parseFormatoNeo(corpo.fim) : undefined;
  } catch (e) { return json({ error: (e as Error).message }, 400); }

  // Responde já (o pg_net não espera) e trabalha em background; o resultado fica em producao_sync_log.
  EdgeRuntime.waitUntil(
    executarSync(criarDeps(), { modo, inicio, fim })
      .then((r) => console.log(JSON.stringify({ modo, ok: r.ok, linhasApi: r.linhasApi, gravadas: r.gravadas, removidas: r.removidas, erro: r.erro })))
      .catch((e) => console.error("sync-producao falhou fora do log:", e)),
  );
  return json({ aceito: true, modo }, 202);
});
