// ============================================================
// Edge Function: sso-pratica-vendas
// ------------------------------------------------------------
// Gera um token de login automático (60s, uso único) pro consultor logado
// no painel abrir o pratica-vendas já autenticado — clique na bolinha
// "Apex Mind". Não recebe nada no corpo: usa só a sessão Supabase de quem
// chama (Authorization já vem automático via sb.functions.invoke).
//
// COMO PUBLICAR (pelo painel do Supabase, sem precisar instalar nada):
// 1. No painel do projeto "apex", vá em "Edge Functions" > "Deploy a new function".
// 2. Nome da função: sso-pratica-vendas
// 3. Cole todo o conteúdo deste arquivo no editor e clique em "Deploy".
// 4. Em "Secrets" da function, adicione SSO_SHARED_SECRET e PRATICA_VENDAS_URL
//    (a mesma SSO_SHARED_SECRET configurada no ambiente do pratica-vendas).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { SignJWT } from "npm:jose@5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SSO_SHARED_SECRET = Deno.env.get("SSO_SHARED_SECRET")!;
const PRATICA_VENDAS_URL = Deno.env.get("PRATICA_VENDAS_URL")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Não autenticado." }, 401);

    const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Sessão inválida." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: perfil, error: perfilErr } = await admin
      .from("profiles")
      .select("nome, username, role")
      .eq("id", userData.user.id)
      .single();
    if (perfilErr || !perfil) return json({ error: "Perfil não encontrado." }, 404);

    // painel tem 3 papéis (admin/supervisor/consultor), pratica-vendas só tem 2 —
    // admin e supervisor entram como admin lá (mesma visibilidade ampla que já têm aqui).
    const papel = perfil.role === "consultor" ? "consultor" : "admin";

    const token = await new SignJWT({
      sub: perfil.username,
      nome: perfil.nome,
      papel,
      jti: crypto.randomUUID(),
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("60s")
      .sign(new TextEncoder().encode(SSO_SHARED_SECRET));

    return json({ url: `${PRATICA_VENDAS_URL}/api/auth/sso?token=${token}` }, 200);
  } catch (e) {
    return json({ error: "Erro inesperado: " + (e as Error).message }, 500);
  }
});

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
