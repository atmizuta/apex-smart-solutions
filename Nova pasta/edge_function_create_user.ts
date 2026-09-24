// ============================================================
// Edge Function: create-user
// ------------------------------------------------------------
// Cria usuários (admin/supervisor/consultor) usando a API
// administrativa do Supabase — não envia nenhum e-mail, então
// não esbarra no limite de "emails per hour" do projeto.
//
// Regras:
// - Se ainda não existir NENHUM usuário no sistema, qualquer
//   chamada cria o primeiro usuário como "admin" (bootstrap).
// - Depois disso, só quem estiver logado como admin (cria
//   supervisor/consultor) ou supervisor (cria só consultor)
//   pode chamar esta função.
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto, vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: create-user
// 3. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { nome, username, password, role } = await req.json();

    if (!nome || !username || !password || String(password).length < 4) {
      return json({ error: "Preencha nome, usuário e uma senha com pelo menos 4 caracteres." }, 400);
    }
    const wantedRole = ["admin", "supervisor", "consultor"].includes(role) ? role : "consultor";

    const { count, error: countErr } = await admin.from("profiles").select("*", { count: "exact", head: true });
    if (countErr) return json({ error: countErr.message }, 500);

    // ---- modo bootstrap: primeiro usuário do sistema, vira admin direto ----
    if (count === 0) {
      return await doCreate(admin, nome, username, password, "admin");
    }

    // ---- modo normal: precisa de um admin/supervisor autenticado chamando ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return json({ error: "Já existe uma equipe cadastrada. Peça para um administrador criar seu acesso." }, 401);
    }
    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);

    const { data: callerProfile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    const callerRole = callerProfile?.role;

    const permitido =
      (callerRole === "admin" && (wantedRole === "admin" || wantedRole === "supervisor" || wantedRole === "consultor")) ||
      (callerRole === "supervisor" && wantedRole === "consultor");
    if (!permitido) {
      return json({ error: "Você não tem permissão para criar esse perfil." }, 403);
    }

    return await doCreate(admin, nome, username, password, wantedRole);
  } catch (e) {
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500);
  }
});

async function doCreate(admin: any, nome: string, username: string, password: string, role: string) {
  const email = username.trim().toLowerCase().replace(/\s+/g, "") + "@apexclientes.com";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) {
    const msg = error.message.includes("already been registered") ? "Esse usuário já existe." : error.message;
    return json({ error: msg }, 400);
  }
  const { error: insErr } = await admin.from("profiles").insert({ id: data.user.id, nome, username, role });
  if (insErr) {
    return json({ error: "Usuário criado, mas houve erro ao salvar o perfil: " + insErr.message }, 500);
  }
  return json({ ok: true, id: data.user.id }, 200);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
