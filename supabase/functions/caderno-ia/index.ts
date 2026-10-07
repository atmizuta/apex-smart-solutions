// Edge Function: caderno-ia (06/10/2026, REGRAS_NEGOCIO.md §72) — resposta de objeção adaptada ao cliente, via Gemini.
// Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md (seção 10).
// Publicar com verify_jwt = true (só usuário logado). Secret: GEMINI_API_KEY (o Rafael cria pelo CLI; nunca no repo).
// Log: só objeção, status e tempo — nunca o texto do cliente.
import { createClient } from "npm:@supabase/supabase-js@2";
import { responder } from "./ia.ts";
import type { DepsIA, Objecao } from "./ia.ts";

const MODELO = "gemini-3.1-flash-lite";
// 07/10/2026: o Gemini gratuito passou de 6 s no 1º uso real. Orçamento total de 12 s; a 2ª tentativa (só em 503)
// acontece se ainda sobrarem 4 s. O painel espera até 15 s (objEstado.timeoutMs).
const ORCAMENTO_MS = 12000;
const FOLGA_RETRY_MS = 4000;
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
  const limite = Date.now() + ORCAMENTO_MS;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const resta = limite - Date.now();
    if (resta <= 0) throw new Error("gemini timeout");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), resta);
    try {
      const r = await fetch(url, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": chave },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          // thinkingBudget 0: sem isso o Gemini 3.x "pensa" antes de responder, passa de 12 s e pode gastar o
          // limite de tokens no raciocínio (07/10/2026: 1º uso real deu timeout). O Apex Mind já usa assim.
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 300,
            thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      // o gratuito devolve 503 "high demand" com frequência: tenta de novo só se ainda houver folga
      if (r.status === 503 && tentativa === 0 && limite - Date.now() > FOLGA_RETRY_MS) continue;
      if (!r.ok) throw new Error(`gemini http ${r.status}`);
      const j = await r.json();
      const texto = j?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      if (!texto) throw new Error("gemini sem texto");
      return texto;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error("gemini timeout");
      throw e;
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
