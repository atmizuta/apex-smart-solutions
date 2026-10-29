// Edge Function: verificar-cnpj (REGRAS_NEGOCIO.md §127) — situação do CNPJ do lead na Receita, só quando alguém clica.
// Spec: docs/superpowers/specs/2026-10-29-verificar-cnpj-design.md. Publicar com verify_jwt = true.
// Recebe { aba, lead_id }; nunca o CNPJ. Log: só status, fonte e situação.
import { createClient } from "npm:@supabase/supabase-js@2";
import { verificar } from "./verificar.ts";
import type { Consulta, Deps, Lead } from "./verificar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const URL_SB = Deno.env.get("SUPABASE_URL") ?? "";
const admin = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });

// O token é validado no Auth, além do verify_jwt do gateway (mesmo padrão da mailing-api).
async function usuario(auth: string | null): Promise<string | null> {
  const jwt = (auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const sb = createClient(URL_SB, Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  return error || !data?.user ? null : data.user.id;
}

const deps: Deps = {
  usuario,
  async papel(uid) {
    const { data, error } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
    if (error) throw error;
    return data?.role ?? null;
  },
  async lead(aba, id) {
    const { data, error } = await admin.from("leads").select("cnpj,dono_id,apagado_em").eq("aba", aba).eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as Lead | null) ?? null;
  },
  async consultaSalva(cnpj) {
    const { data, error } = await admin.from("cnpj_consultas").select("*").eq("cnpj", cnpj).maybeSingle();
    if (error) throw error;
    return (data as Consulta | null) ?? null;
  },
  async salvar(c) {
    const { error } = await admin.from("cnpj_consultas").upsert(c, { onConflict: "cnpj" });
    if (error) throw error;
  },
  async buscar(url, ms) {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: "application/json" } });
    let corpo: unknown = null;
    try { corpo = await r.json(); } catch (_e) { corpo = null; }
    return { status: r.status, corpo };
  },
  agora: () => new Date(),
  log: (m) => console.log(`verificar-cnpj: ${m}`),
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, erro: "metodo" }, 405);
  let corpo: Record<string, unknown> = {};
  try { corpo = await req.json(); } catch (_e) { corpo = {}; }
  try {
    const r = await verificar({ auth: req.headers.get("Authorization"), aba: String(corpo.aba ?? ""), lead_id: String(corpo.lead_id ?? "") }, deps);
    return json(r.corpo, r.status);
  } catch (_e) {
    console.log("verificar-cnpj: erro interno");
    return json({ ok: false, erro: "interno" }, 500);
  }
});
