// Edge Function: mailing-api (REGRAS_NEGOCIO.md seção 102) — opções, contagem, extração no layout do ProContact e histórico.
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (seção 5). Publicar com verify_jwt = true.
// Conexão direta ao banco (SUPABASE_DB_URL, disponível em toda Edge Function): o PostgREST corta em 8 s e 1.000 linhas.
// Log: só status e código de erro — nunca CPF, nome, telefone ou filtros.
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./api.ts";
import type { DepsApi, LinhaExport, RegistroExtracao, Usuario } from "./api.ts";
import {
  sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, SQL_REGISTRAR, SQL_OPCOES, SQL_CARGA, SQL_HISTORICO, SQL_USUARIO,
  sqlTrechoNovos, sqlJanelaUsadas, sqlTrechoUsadas, ultimaPagina, ultimoTomado, SQL_PAGINAS, SQL_PARTE, SQL_SOMAR_PARTE,
  SQL_REGISTRAR_PARTE,
} from "./consulta.ts";
import type { SqlParte, ResultadoTrecho } from "./consulta.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
// O token é validado no Auth do Supabase, além do verify_jwt do gateway. Só ler o "sub" não basta: se o verify_jwt
// fosse desligado um dia, um "sub" forjado de admin exportaria a base inteira (revisão final, 21/10).
async function idDoUsuario(auth: string | null): Promise<string | null> {
  const jwt = (auth ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return null;
  const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", { auth: { persistSession: false } });
  const { data, error } = await sb.auth.getUser(jwt);
  return error || !data?.user ? null : data.user.id;
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
    // 22/10 (seção 102.10): um trecho limitado por chamada; o painel repete até completar o pedido
    async extrairTrecho(w, ped, reg) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '100s'");
        await tx.unsafe("set local work_mem = '64MB'");
        // um trecho por vez: o seguinte já enxerga o que o anterior marcou
        await tx.unsafe("select pg_advisory_xact_lock(hashtext('mailing.extracao'))");
        const [parte] = await tx.unsafe(SQL_PARTE, [reg.pedido, reg.parte, reg.user_id] as never[]);
        // estimativa do registro: antes de marcar, como na extração de uma vez
        const total = parte ? 0 : Number((await tx.unsafe(sqlTotalFiltro(w), p(w)))[0].n);
        let linhas: (LinhaExport & Record<string, unknown>)[] = [];
        let resultado: ResultadoTrecho;
        if (ped.trecho.fase === 1) {
          const [pg] = await tx.unsafe(SQL_PAGINAS);
          const paginas = Number(pg.n), de = ped.trecho.pagina;
          const ate = Math.max(de, Math.min(de + ped.trecho.paginas, paginas));
          if (de < ate) {
            const q = sqlTrechoNovos(w, de, ate, ped.quantidade);
            linhas = [...(await tx.unsafe(q.sql, q.params as never[]))] as unknown as typeof linhas;
          }
          resultado = { fase: 1, tomadas: linhas.length, ultima_pagina: ultimaPagina(linhas), ate, paginas_total: paginas };
        } else {
          const j = sqlJanelaUsadas(ped.inicio, ped.trecho.apos);
          const [jan] = await tx.unsafe(j.sql, j.params as never[]);
          const fim = jan ? { ue: String(jan.ue), so: Number(jan.so) } : null;
          if (fim) {
            const q = sqlTrechoUsadas(w, ped.inicio, ped.trecho.apos, fim, ped.quantidade);
            linhas = [...(await tx.unsafe(q.sql, q.params as never[]))] as unknown as typeof linhas;
          }
          resultado = { fase: 2, tomadas: linhas.length, ultimo: ultimoTomado(linhas), janela: { n: jan ? Number(jan.n) : 0, fim } };
        }
        if (linhas.length && parte) await tx.unsafe(SQL_SOMAR_PARTE, [parte.id, linhas.length] as never[]);
        else if (linhas.length) {
          await tx.unsafe(SQL_REGISTRAR_PARTE, [reg.user_id, reg.username, reg.role, reg.operacao, reg.nome_carga,
            JSON.stringify(reg.filtros), total, reg.quantidade_pedida, linhas.length, reg.pedido, reg.parte] as never[]);
        }
        return { linhas, resultado };
      });
    },
    hojeISO: hojeSP,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });
  try {
    const sub = await idDoUsuario(req.headers.get("Authorization"));
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
