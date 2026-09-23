// ============================================================
// Edge Function: reset-password
// ------------------------------------------------------------
// Permite que um Admin redefina a senha de Supervisor/Consultor,
// e que um Supervisor redefina a senha de Consultor.
// Usa a service_role key (fica só aqui no servidor, nunca no navegador).
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto, vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: reset-password
// 3. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// (A service_role key já fica disponível automaticamente dentro da função,
//  não precisa configurar nada a mais.)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Não autenticado." }, 401, corsHeaders);
    }

    // Cliente "como o usuário que chamou" — para descobrir quem é e checar o perfil dele
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Sessão inválida." }, 401, corsHeaders);
    }
    const callerId = userData.user.id;

    // Cliente admin (service role) — para consultar perfis e alterar a senha de outra pessoa
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: callerProfile, error: callerProfileErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    if (callerProfileErr || !callerProfile) {
      return json({ error: "Perfil do solicitante não encontrado." }, 403, corsHeaders);
    }

    const { targetUserId, newPassword } = await req.json();
    if (!targetUserId || !newPassword || String(newPassword).length < 4) {
      return json({ error: "Dados inválidos (usuário ou senha)." }, 400, corsHeaders);
    }

    const { data: targetProfile, error: targetErr } = await admin
      .from("profiles")
      .select("role")
      .eq("id", targetUserId)
      .single();
    if (targetErr || !targetProfile) {
      return json({ error: "Usuário alvo não encontrado." }, 404, corsHeaders);
    }

    const callerRole = callerProfile.role;
    const targetRole = targetProfile.role;
    const permitido =
      (callerRole === "admin" && (targetRole === "admin" || targetRole === "supervisor" || targetRole === "consultor")) ||
      (callerRole === "supervisor" && targetRole === "consultor");

    if (!permitido) {
      return json({ error: "Você não tem permissão para redefinir a senha deste usuário." }, 403, corsHeaders);
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(targetUserId, {
      password: String(newPassword),
    });
    if (updateErr) {
      return json({ error: "Erro ao redefinir senha: " + updateErr.message }, 500, corsHeaders);
    }

    return json({ ok: true }, 200, corsHeaders);
  } catch (e) {
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500, corsHeaders);
  }
});

function json(body: unknown, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
