// Edge Function: relatorio-pedidos-parados — e-mail diário (seg–sex 08:00 SP) com o Excel dos pedidos parados em
// Antifraude e Entrega para a executiva da Claro. REGRAS_NEGOCIO.md §81; spec
// docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md.
// Chamada pelo pg_cron (header x-cron-secret = SYNC_CRON_SECRET), sem JWT.
// Body: {"modo":"agendado"} (padrão) | {"modo":"teste","para":["..."]} | {"modo":"reenviar"}.
// Secrets: SMTP_USER e SMTP_PASS (obrigatórios); SMTP_HOST e SMTP_PORT (opcionais; padrão smtp.hostinger.com:465).
// Publicar: npx supabase functions deploy relatorio-pedidos-parados --project-ref mdgfboijyqfkggcrhptn --no-verify-jwt --use-api
import { createClient } from "npm:@supabase/supabase-js@2";
import ExcelJS from "npm:exceljs@4.4.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { MODOS, executarRelatorio, lerTodasPaginas, ocultarSegredo } from "./relatorio.ts";
import type { Deps, Modo } from "./relatorio.ts";
import { gerarPlanilha } from "./planilha.ts";
import type { Linha } from "./regras.ts";

const RELATORIO = "pedidos_parados";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

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

function criarDeps(): Deps {
  const sb = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const smtpUser = env("SMTP_USER");
  const smtpPass = env("SMTP_PASS");
  const falha = (ctx: string, error: { message: string } | null) => { if (error) throw new Error(`${ctx}: ${error.message}`); };

  return {
    agora: () => new Date(),
    async lerDestinatarios() {
      const { data, error } = await sb.from("relatorio_destinatarios").select("para, cc, ativo")
        .eq("relatorio", RELATORIO).maybeSingle();
      falha("ler destinatários", error);
      return data ? { para: data.para ?? [], cc: data.cc ?? [], ativo: data.ativo !== false } : null;
    },
    async jaEnviouHoje(diaRef) {
      const { count, error } = await sb.from("relatorio_envio_log").select("id", { count: "exact", head: true })
        .eq("relatorio", RELATORIO).eq("data_ref", diaRef).eq("status", "enviado").neq("modo", "teste");
      falha("ler envios de hoje", error);
      return (count ?? 0) > 0;
    },
    lerLinhas: () => lerTodasPaginas<Linha>(async (de, ate) => {
      const { data, error } = await sb.rpc("relatorio_pedidos_parados_linhas").range(de, ate);
      falha("ler pedidos", error);
      return (data ?? []) as Linha[];
    }),
    async ultimaSincronizacao() {
      const { data, error } = await sb.from("config").select("atualizado_em")
        .eq("chave", "producao_neo_atualizado_em").maybeSingle();
      falha("ler última sincronização", error);
      return data?.atualizado_em ? new Date(data.atualizado_em) : null;
    },
    gerarPlanilha: (pedidos, info) => gerarPlanilha(ExcelJS, pedidos, info),
    async enviar(m) {
      const client = new SMTPClient({
        connection: {
          hostname: Deno.env.get("SMTP_HOST") || "smtp.hostinger.com",
          port: Number(Deno.env.get("SMTP_PORT") || 465),
          tls: true,
          auth: { username: smtpUser, password: smtpPass },
        },
      });
      try {
        await client.send({
          from: `Apex Smart Solutions <${smtpUser}>`,
          to: m.para,
          ...(m.cc.length ? { cc: m.cc } : {}),
          subject: m.assunto,
          content: m.texto,
          html: m.html,
          attachments: m.anexo
            ? [{ filename: m.anexo.nome, content: m.anexo.bytes, encoding: "binary", contentType: XLSX_MIME }]
            : [],
        });
      } catch (e) {
        throw new Error(ocultarSegredo((e as Error).message, smtpPass));
      } finally {
        try { await client.close(); } catch { /* a conexão já pode ter caído */ }
      }
    },
    async registrar(r) {
      const { error } = await sb.from("relatorio_envio_log").insert({ relatorio: RELATORIO, ...r });
      falha("gravar log", error);
    },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!iguais(req.headers.get("x-cron-secret") ?? "", env("SYNC_CRON_SECRET"))) return json({ error: "Não autorizado" }, 401);

  let corpo: { modo?: unknown; para?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio = agendado */ }
  const modo = (corpo.modo ?? "agendado") as Modo;
  if (!MODOS.includes(modo)) return json({ error: `modo inválido: ${String(corpo.modo)}` }, 400);

  try {
    const r = await executarRelatorio(criarDeps(), { modo, paraTeste: corpo.para });
    console.log(JSON.stringify({ ...r, destinatarios: r.destinatarios.length }));
    return json(r, r.status === "erro" ? 502 : 200);
  } catch (e) {
    const msg = ocultarSegredo((e as Error).message, Deno.env.get("SMTP_PASS"));
    console.error("relatorio-pedidos-parados falhou:", msg);
    return json({ error: msg }, 500);
  }
});
