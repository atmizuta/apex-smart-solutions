// Edge Function: mailing-api (REGRAS_NEGOCIO.md seção 102) — opções, contagem, extração no layout do ProContact e histórico.
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (seção 5). Publicar com verify_jwt = true.
// Conexão direta ao banco (SUPABASE_DB_URL, disponível em toda Edge Function): o PostgREST corta em 8 s e 1.000 linhas.
// Log: só status e código de erro — nunca CPF, nome, telefone ou filtros.
import postgres from "npm:postgres@3.4.5";
import { processar } from "./api.ts";
import type { DepsApi, LinhaExport, RegistroExtracao, Usuario } from "./api.ts";
import {
  sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, SQL_REGISTRAR, SQL_OPCOES, SQL_CARGA, SQL_HISTORICO, SQL_USUARIO,
} from "./consulta.ts";
import type { SqlParte } from "./consulta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// verify_jwt = true: o gateway já validou a assinatura; aqui só lemos o "sub" (id do usuário).
function subDoJwt(auth: string | null): string | null {
  const partes = (auth ?? "").replace(/^Bearer\s+/i, "").split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
function hojeSP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date());
}

function criarDeps(sql: postgres.Sql): DepsApi {
  const p = (w: SqlParte) => w.params as never[];
  return {
    async opcoes() {
      const [opcoes, carga] = await Promise.all([sql.unsafe(SQL_OPCOES), sql.unsafe(SQL_CARGA)]);
      return { opcoes: [...opcoes], carga: carga[0] ?? null };
    },
    async historico() {
      return [...(await sql.unsafe(SQL_HISTORICO))];
    },
    async contar(w) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '30s'");
        const [t] = await tx.unsafe(sqlTotais(w), p(w));
        const ops = await tx.unsafe(sqlPorOperadora(w), p(w));
        return {
          linhas: Number(t.linhas), empresas: Number(t.empresas), telefones: Number(t.telefones),
          por_operadora: ops.map((o) => ({ operadora: String(o.operadora), linhas: Number(o.linhas) })),
        };
      });
    },
    async extrair(w, quantidade, reg: RegistroExtracao) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '120s'");
        const [t] = await tx.unsafe(sqlTotalFiltro(w), p(w));
        const linhas = [...(await tx.unsafe(sqlExtrair(w), [...w.params, quantidade] as never[]))] as unknown as LinhaExport[];
        if (linhas.length) { // filtro vazio não vira registro
          await tx.unsafe(SQL_REGISTRAR, [reg.user_id, reg.username, reg.role, reg.operacao, reg.nome_carga,
            JSON.stringify(reg.filtros), Number(t.n), reg.quantidade_pedida, linhas.length] as never[]);
        }
        return { linhas, total_no_filtro: Number(t.n) };
      });
    },
    hojeISO: hojeSP,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const sub = subDoJwt(req.headers.get("Authorization"));
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
  try {
    let usuario: Usuario | null = null;
    if (sub) {
      const [perfil] = await sql.unsafe(SQL_USUARIO, [sub]);
      if (perfil) usuario = { id: sub, role: String(perfil.role), operacao: perfil.operacao ?? null, username: perfil.username ?? null };
    }
    const corpo = await req.json().catch(() => null);
    const r = await processar(corpo, usuario, criarDeps(sql));
    if (r.status >= 500) console.error("mailing-api", r.status);
    return json(r.body, r.status);
  } catch (e) {
    console.error("mailing-api falhou", (e as { code?: string })?.code ?? "sem código");
    return json({ erro: "Falha ao consultar a base de mailing." }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
