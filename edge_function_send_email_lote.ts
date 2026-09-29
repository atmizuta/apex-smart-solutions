// ============================================================
// Edge Function: send-email-lote
// ------------------------------------------------------------
// Dispara e-mails em lote (até 10 destinatários por chamada) usando as
// credenciais SMTP que o PRÓPRIO consultor logado conectou na aba
// "Configurações" do painel (tabela user_email_config). O envio acontece
// aqui, no servidor — nunca no navegador — pra nunca expor a senha do
// e-mail do consultor no cliente.
//
// Fluxo:
// 1. Confere o JWT de quem chamou (igual às outras Edge Functions do
//    projeto) e descobre o user_id de quem está autenticado.
// 2. Busca a linha desse user_id em user_email_config (RLS já garante
//    que só existe uma linha por usuário, mas aqui usamos o client com
//    service role, então filtramos explicitamente por user_id).
// 3. Pra cada destinatário, substitui {{cliente}} no assunto e no HTML
//    (o {{consultor}} já vem resolvido do painel, antes de chamar esta
//    function) e envia via SMTP Hostinger (porta 465, TLS) usando as
//    credenciais daquele consultor.
// 4. Devolve um array com o resultado (ok/erro) de cada destinatário.
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. Rode antes o SQL da seção "11) CONFIGURAÇÃO DE E-MAIL POR USUÁRIO"
//    em supabase_schema.sql (Supabase > SQL Editor > New query > Run).
// 2. No painel do projeto, vá em "Edge Functions" > "Deploy a new function".
// 3. Nome da função: send-email-lote
// 4. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// Nenhuma variável de ambiente extra precisa ser configurada — a função
// usa SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY, que o Supabase já injeta
// automaticamente em toda Edge Function.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_DESTINATARIOS = 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // ---- 1) confere quem está chamando ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Sessão inválida — faça login novamente." }, 401);
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida — faça login novamente." }, 401);
    const userId = userData.user.id;

    // ---- 2) valida o corpo da requisição ----
    const { destinatarios, assunto, corpoHtml, nomeConsultor } = await req.json();
    if (!Array.isArray(destinatarios) || destinatarios.length === 0) {
      return json({ error: "Nenhum destinatário informado." }, 400);
    }
    if (destinatarios.length > MAX_DESTINATARIOS) {
      return json({ error: `No máximo ${MAX_DESTINATARIOS} destinatários por envio.` }, 400);
    }
    if (!assunto || !corpoHtml) {
      return json({ error: "Assunto e corpo do e-mail são obrigatórios." }, 400);
    }
    for (const d of destinatarios) {
      if (!d || typeof d.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
        return json({ error: `E-mail inválido: ${d && d.email}` }, 400);
      }
    }

    // ---- 3) busca a config SMTP do usuário logado ----
    const { data: config, error: cfgErr } = await admin
      .from("user_email_config")
      .select("email, smtp_pass, smtp_host, smtp_port, nome_exibicao, ativo")
      .eq("user_id", userId)
      .maybeSingle();
    if (cfgErr) return json({ error: "Erro ao buscar sua configuração de e-mail: " + cfgErr.message }, 500);
    if (!config || config.ativo === false) {
      return json({ error: "Você ainda não conectou seu e-mail em Configurações." }, 400);
    }

    // ---- 4) envia um a um, substituindo {{cliente}} por destinatário ----
    const client = new SMTPClient({
      connection: {
        hostname: config.smtp_host || "smtp.hostinger.com",
        port: config.smtp_port || 465,
        tls: true,
        auth: { username: config.email, password: config.smtp_pass },
      },
    });

    const resultados: { email: string; ok: boolean; erro?: string }[] = [];
    for (const dest of destinatarios) {
      const nomeCliente = (dest.nome || "").trim() || "sua empresa";
      const assuntoFinal = assunto.replace(/\{\{cliente\}\}/g, nomeCliente);
      const corpoFinal = corpoHtml.replace(/\{\{cliente\}\}/g, nomeCliente);
      try {
        await client.send({
          from: `${config.nome_exibicao || nomeConsultor || "Apex Smart Solutions"} <${config.email}>`,
          to: dest.email,
          subject: assuntoFinal,
          html: corpoFinal,
        });
        resultados.push({ email: dest.email, ok: true });
      } catch (e) {
        resultados.push({ email: dest.email, ok: false, erro: (e as Error).message });
      }
    }
    try { await client.close(); } catch (_e) { /* já pode ter fechado sozinho em erro de conexão */ }

    return json({ resultados }, 200);
  } catch (e) {
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
