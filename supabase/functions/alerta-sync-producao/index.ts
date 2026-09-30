// Edge Function: alerta-sync-producao — avisa quando a sincronização da produção (sync-producao) para.
// Chamada só pelo pg_cron, de 15 em 15 minutos (header x-cron-secret, o mesmo da sync-producao); por isso
// roda sem JWT. Não consulta a NeoSales: só lê producao_sync_log e grava producao_sync_alerta.
// Canal de aviso: Telegram, se os secrets ALERTA_TELEGRAM_TOKEN e ALERTA_TELEGRAM_CHAT_ID existirem. Sem eles o
// alerta fica registrado e o aviso pendente sai assim que o canal for configurado.
// Limite: secret ALERTA_LIMITE_HORAS (padrão 3).
// Publicar: npx supabase functions deploy alerta-sync-producao --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import { enviarTelegram, executarAlerta } from "./alerta.ts";
import type { DepsAlerta } from "./alerta.ts";

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

function criarDeps(): DepsAlerta {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const token = Deno.env.get("ALERTA_TELEGRAM_TOKEN");
  const chatId = Deno.env.get("ALERTA_TELEGRAM_CHAT_ID");
  const falha = (ctx: string, error: { message: string } | null) => { if (error) throw new Error(`${ctx}: ${error.message}`); };

  return {
    agora: () => new Date(),
    async ultimoOkEm() {
      const { data, error } = await sb.from("producao_sync_log").select("terminou_em, janela_fim")
        .eq("ok", true).neq("modo", "manual").order("id", { ascending: false }).limit(1);
      falha("ler última sincronização", error);
      const l = data && data[0];
      const quando = l ? (l.terminou_em ?? l.janela_fim) : null;
      return quando ? new Date(quando) : null;
    },
    async ultimoErro() {
      // só conta se a execução mais recente falhou; um erro antigo não explica uma parada de agora
      const { data, error } = await sb.from("producao_sync_log").select("ok, erro").order("id", { ascending: false }).limit(1);
      falha("ler último erro", error);
      const l = data && data[0];
      return l && l.ok === false ? (l.erro ?? null) : null;
    },
    async alertaAberto() {
      const { data, error } = await sb.from("producao_sync_alerta")
        .select("id, aberto_em, notificado_abertura").is("resolvido_em", null).limit(1);
      falha("ler alerta aberto", error);
      const a = data && data[0];
      return a ? { id: a.id as number, abertoEm: new Date(a.aberto_em), notificadoAbertura: !!a.notificado_abertura } : null;
    },
    async abrirAlerta(info) {
      const { data, error } = await sb.from("producao_sync_alerta")
        .insert({ ultimo_ok_em: info.ultimoOkEm ? info.ultimoOkEm.toISOString() : null, ultimo_erro: info.ultimoErro })
        .select("id").single();
      falha("abrir alerta", error);
      return data!.id as number;
    },
    async resolverAlerta(id) {
      const { error } = await sb.from("producao_sync_alerta").update({ resolvido_em: new Date().toISOString() }).eq("id", id);
      falha("resolver alerta", error);
    },
    async marcarNotificado(id, tipo) {
      const coluna = tipo === "abertura" ? "notificado_abertura" : "notificado_resolucao";
      const { error } = await sb.from("producao_sync_alerta").update({ [coluna]: true }).eq("id", id);
      falha("marcar aviso enviado", error);
    },
    async notificar(texto) {
      if (!token || !chatId) return false;
      await enviarTelegram({ token, chatId }, texto);
      return true;
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!iguais(req.headers.get("x-cron-secret") ?? "", env("SYNC_CRON_SECRET"))) return json({ error: "Não autorizado" }, 401);

  let corpo: { limiteHoras?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio é válido */ }
  const sobrescrito = corpo.limiteHoras !== undefined ? Number(corpo.limiteHoras) : NaN;
  const daEnv = Number(Deno.env.get("ALERTA_LIMITE_HORAS") ?? 3);
  const limiteHoras = Number.isFinite(sobrescrito) && sobrescrito > 0 && sobrescrito <= 168
    ? sobrescrito
    : (Number.isFinite(daEnv) && daEnv > 0 ? daEnv : 3);

  try {
    const r = await executarAlerta(criarDeps(), { limiteHoras });
    console.log(JSON.stringify({ limiteHoras, ...r }));
    return json({ limiteHoras, canalConfigurado: !!(Deno.env.get("ALERTA_TELEGRAM_TOKEN") && Deno.env.get("ALERTA_TELEGRAM_CHAT_ID")), ...r }, 200);
  } catch (e) {
    console.error("alerta-sync-producao falhou:", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
