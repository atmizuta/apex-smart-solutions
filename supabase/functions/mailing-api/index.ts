// Edge Function: mailing-api (REGRAS_NEGOCIO.md seção 102) — opções, contagem, extração no layout do ProContact e histórico.
// 23/10 (seção 110): contagem completa em segundo plano (fila mailing.contagem + job contar_proxima).
// Spec: docs/superpowers/specs/2026-10-20-base-mailing-design.md (seção 5). Publicar com verify_jwt = true.
// Conexão direta ao banco (SUPABASE_DB_URL, disponível em toda Edge Function): o PostgREST corta em 8 s e 1.000 linhas.
// Log: só status e código de erro — nunca CPF, nome, telefone ou filtros.
import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2";
import { processar } from "./api.ts";
import type { DepsApi, LinhaContagem, LinhaExport, RegistroExtracao, Usuario } from "./api.ts";
import {
  sqlTotais, sqlPorOperadora, sqlTotalFiltro, sqlExtrair, SQL_REGISTRAR, SQL_OPCOES, SQL_CARGA, SQL_HISTORICO, SQL_USUARIO,
  sqlTrechoNovos, sqlJanelaUsadas, sqlTrechoUsadas, ultimaPagina, ultimoTomado, SQL_PAGINAS, SQL_PARTE, SQL_SOMAR_PARTE,
  SQL_REGISTRAR_PARTE, SQL_NEO, SQL_FECHAR_PARTE, SQL_CONTAGEM_EXISTENTE, SQL_CONTAGEM_NOVA, SQL_CONTAGEM_VISTA, SQL_CONTAGEM_VER,
  SQL_CONTAGEM_PARAR, SQL_AGORA, SQL_FASE1_ESGOTADA_VER, SQL_FASE1_ESGOTADA_MARCAR, fase1Esgotou,
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

const LIMITE_TRECHO_MS = 110_000; // abaixo dos 150 s do gateway, com folga para conexão e resposta

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
    // 04/11 (seção 134.1): a chamada inteira cabe em LIMITE_TRECHO_MS. Antes eram 100 s por comando: dois comandos lentos
    // passaram dos 150 s do gateway (504 sem resposta). Agora o banco desiste antes, desfaz tudo (nenhuma linha fica marcada
    // sem ir para o arquivo) e a função responde 504 "demorou demais" — o painel tenta o mesmo trecho de novo.
    async extrairTrecho(w, ped, reg) {
      const comeco = Date.now();
      return await sql.begin(async (tx) => {
        const prazo = () => tx.unsafe(`set local statement_timeout = ${Math.max(1000, LIMITE_TRECHO_MS - (Date.now() - comeco))}`);
        await prazo();
        await tx.unsafe("set local work_mem = '64MB'");
        // um trecho por vez: o seguinte já enxerga o que o anterior marcou
        await tx.unsafe("select pg_advisory_xact_lock(hashtext('mailing.extracao'))");
        await prazo();
        const [parte] = await tx.unsafe(SQL_PARTE, [reg.pedido, reg.parte, reg.user_id] as never[]);
        // estimativa do registro: antes de marcar, como na extração de uma vez
        const total = parte ? 0 : Number((await tx.unsafe(sqlTotalFiltro(w), p(w)))[0].n);
        let linhas: (LinhaExport & Record<string, unknown>)[] = [];
        let resultado: ResultadoTrecho;
        await prazo();
        if (ped.trecho.fase === 1) {
          const [pg] = await tx.unsafe(SQL_PAGINAS);
          const paginas = Number(pg.n), de = ped.trecho.pagina;
          // 14/11 (seção 152.3): filtro sem nenhum nunca extraído desde a última carga = não lê a tabela (eram ~5 min)
          const esgotada = (await tx.unsafe(SQL_FASE1_ESGOTADA_VER, [ped.chave] as never[])).length > 0;
          const ate = esgotada ? paginas : Math.max(de, Math.min(de + ped.trecho.paginas, paginas));
          if (!esgotada && de < ate) {
            const q = sqlTrechoNovos(w, de, ate, ped.quantidade);
            linhas = [...(await tx.unsafe(q.sql, q.params as never[]))] as unknown as typeof linhas;
          }
          resultado = { fase: 1, tomadas: linhas.length, ultima_pagina: ultimaPagina(linhas), ate, paginas_total: paginas };
          if (!esgotada && fase1Esgotou(resultado, ped.quantidade)) await tx.unsafe(SQL_FASE1_ESGOTADA_MARCAR, [ped.chave] as never[]);
        } else {
          const j = sqlJanelaUsadas(ped.inicio, ped.trecho.apos);
          const [jan] = await tx.unsafe(j.sql, j.params as never[]);
          const fim = jan ? { ue: String(jan.ue), so: Number(jan.so) } : null;
          await prazo();
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
    // 23/10 (seção 110): a contagem completa roda no job do banco; aqui só a fila e o andamento (consultas curtas)
    async pedirContagem(chave, fila, reaproveitar, u) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '15s'");
        const [ja] = await tx.unsafe(SQL_CONTAGEM_EXISTENTE, [chave, reaproveitar] as never[]);
        if (ja) return Number(ja.id);
        const [nova] = await tx.unsafe(SQL_CONTAGEM_NOVA,
          [chave, fila.where_sql, JSON.stringify(fila.params), u.id, u.username] as never[]);
        return Number(nova.id);
      });
    },
    async verContagem(id) {
      return await sql.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '15s'");
        await tx.unsafe(SQL_CONTAGEM_VISTA, [id] as never[]);
        const [c] = await tx.unsafe(SQL_CONTAGEM_VER, [id] as never[]);
        return (c ?? null) as LinhaContagem | null;
      });
    },
    async pararContagem(id, userId) {
      const [r] = await sql.unsafe(SQL_CONTAGEM_PARAR, [id, userId] as never[]);
      return Number(r?.achou) > 0;
    },
    async neo() {
      return [...(await sql.unsafe(SQL_NEO))];
    },
    async fecharParte(pedido, parte, userId, neo, repetidos) {
      return (await sql.unsafe(SQL_FECHAR_PARTE, [pedido, parte, userId, neo, repetidos] as never[])).length > 0;
    },
    async agora() {
      return String((await sql.unsafe(SQL_AGORA))[0].agora);
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
