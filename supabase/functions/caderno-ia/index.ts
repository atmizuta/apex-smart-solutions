// Edge Function: caderno-ia (06/10/2026, REGRAS_NEGOCIO.md §72) — resposta de objeção adaptada ao cliente, via Gemini.
// Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md (seção 10).
// Publicar com verify_jwt = true (só usuário logado). Secret: GEMINI_API_KEY (o Rafael cria pelo CLI; nunca no repo).
// Log: só objeção, status e tempo — nunca o texto do cliente.
import { createClient } from "npm:@supabase/supabase-js@2";
import { responder } from "./ia.ts";
import type { DepsIA, Objecao } from "./ia.ts";

const MODELO = "gemini-3.1-flash-lite";
const TIMEOUT_MS = 6000;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function env(k: string): string {
  const v = Deno.env.get(k);
  if (!v) throw new Error(`Variável de ambiente ausente: ${k}`);
  return v;
}

async function gemini(prompt: string, chave: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 300 },
        }),
      });
      if (r.status === 503 && tentativa === 0) continue; // o gratuito devolve 503 "high demand" com frequência
      if (!r.ok) throw new Error(`gemini http ${r.status}`);
      const j = await r.json();
      const texto = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      if (!texto) throw new Error("gemini sem texto");
      return texto;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("gemini indisponível");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  try {
    // Valida o JWT do usuário explicitamente (token tirado do "Bearer …"), em vez de depender do header
    // global de um cliente com a service role (revisão final M-10).
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "Não autenticado." }, 401);
    const url = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY"), chave = env("GEMINI_API_KEY");
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: u, error: ue } = await admin.auth.getUser(jwt);
    if (ue || !u?.user) return json({ error: "Sessão inválida." }, 401);
    const campos = "chave,rotulo,fala,pergunta,alternativa";
    const deps: DepsIA = {
      async buscarObjecao(c) {
        const { data } = await admin.from("objecoes_respostas").select(campos).eq("chave", c).eq("ativo", true).maybeSingle();
        return (data as Objecao | null) ?? null;
      },
      async listarObjecoes() {
        const { data } = await admin.from("objecoes_respostas").select(campos).eq("ativo", true).order("ordem");
        return (data as Objecao[] | null) ?? [];
      },
      async contarChamadas(uid, desde) {
        const { count } = await admin.from("caderno_ia_chamadas").select("id", { count: "exact", head: true })
          .eq("consultor_id", uid).gte("criado_em", desde);
        return count ?? 0;
      },
      async registrarChamada(r) {
        const { error } = await admin.from("caderno_ia_chamadas").insert(r);
        if (error) console.error("caderno-ia: falha ao registrar chamada", error.code ?? "?");
      },
      chamarGemini: (p) => gemini(p, chave),
      agora: () => Date.now(),
    };
    let corpo: unknown;
    try { corpo = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
    const r = await responder(corpo, u.user.id, deps);
    console.log(`caderno-ia status=${r.status}`);
    return json(r.body, r.status);
  } catch (e) {
    console.error("caderno-ia: erro", e instanceof Error ? e.message.slice(0, 80) : "?");
    return json({ error: "ia_indisponivel" }, 503);
  }
});
