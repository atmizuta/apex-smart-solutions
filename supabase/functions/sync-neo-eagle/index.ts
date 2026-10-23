// Edge Function: sync-neo-eagle — pedidos da Eagle no NeoSales (API do Relatório de Exportação Xeotech, painel 15216)
// em mailing.neo_eagle, 1 linha por pedido, últimos 150 dias de cadastro. REGRAS_NEGOCIO.md §108.
// SÓ para o "Cruzar com o NEO" da aba Base de Mailing: nunca gravar em producao_* nem em nada que o Dashboard leia.
// Chamada só pelo pg_cron (header x-cron-secret); sem JWT. Token da API: secret NEO_EAGLE_TOKEN (nunca em log/resposta).
// Corpo: {} = rotina diária (anteontem até hoje); {"dataInicio","dataFim"} = carga à mão (até 3 meses);
// {"modo":"teste"} = tudo menos gravar, devolve só contagens.
import postgres from "npm:postgres@3.4.5";
import { DIAS_GUARDADOS, diaSP, mensagemErro, ocultarToken, pedidosEagle, periodoDiario, periodoValido } from "./eagle.ts";

const API = "https://api.xeotech.com.br/api/v1/producao/exportacao/";
const PAINEL_ID = 15216;
const LOTE = 1000;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get("SYNC_CRON_SECRET") ?? "";
  if (!cronSecret || !iguais(req.headers.get("x-cron-secret") ?? "", cronSecret)) return json({ error: "Não autorizado." }, 401);
  let corpo: { modo?: string; dataInicio?: unknown; dataFim?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo vazio */ }
  const teste = corpo.modo === "teste";
  const manual = corpo.dataInicio !== undefined || corpo.dataFim !== undefined;
  if (manual && !periodoValido(corpo)) return json({ ok: false, erro: "Período inválido: aaaa-mm-dd, início ≤ fim, até 3 meses." }, 400);
  const periodo = manual ? { dataInicio: corpo.dataInicio as string, dataFim: corpo.dataFim as string } : periodoDiario(Date.now());
  const token = Deno.env.get("NEO_EAGLE_TOKEN") ?? "";
  const sql = postgres(Deno.env.get("SUPABASE_DB_URL") ?? "", { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 10 });

  let logId: number | null = null;
  const fechar = async (campos: Record<string, unknown>) => {
    if (logId === null) return;
    await sql`update mailing.neo_eagle_sync set ${sql(campos)}, terminou_em = now() where id = ${logId}`;
  };

  try {
    if (!teste) {
      const [l] = await sql`insert into mailing.neo_eagle_sync (periodo) values (${periodo.dataInicio + " a " + periodo.dataFim}) returning id`;
      logId = Number(l.id);
    }
    if (!token) throw new Error("Secret NEO_EAGLE_TOKEN ausente.");
    const resp = await fetch(API + encodeURIComponent(token), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ painelId: PAINEL_ID, ...periodo, formato: "json" }),
    });
    const texto = await resp.text();
    if (!resp.ok) {
      const erro = ocultarToken(mensagemErro(resp.status, texto, resp.headers.get("Retry-After")), token);
      await fechar({ ok: false, http: resp.status, erro });
      return json({ ok: false, erro }, 502);
    }
    let j: { dados?: unknown };
    try {
      j = JSON.parse(texto) as { dados?: unknown };
    } catch {
      throw new Error("Resposta da API não é JSON: " + texto.slice(0, 200));
    }
    if (!Array.isArray(j.dados)) throw new Error(mensagemErro(resp.status, texto, null));
    const linhas = j.dados as Record<string, unknown>[];
    const corte = diaSP(Date.now(), DIAS_GUARDADOS);
    const pedidos = pedidosEagle(linhas, corte);
    if (teste) return json({ ok: true, teste: true, periodo, linhas: linhas.length, pedidos: pedidos.length, cnpjs: new Set(pedidos.map((p) => p.cnpj)).size }, 200);

    const agora = new Date().toISOString();
    let gravados = 0;
    for (let i = 0; i < pedidos.length; i += LOTE) {
      const lote = pedidos.slice(i, i + LOTE).map((p) => ({ ...p, sincronizado_em: agora }));
      await sql`insert into mailing.neo_eagle ${sql(lote)}
        on conflict (numero_pedido) do update set cnpj = excluded.cnpj, etapa = excluded.etapa, consultor = excluded.consultor,
          cadastro = excluded.cadastro, atualizado_em_neo = excluded.atualizado_em_neo, sincronizado_em = excluded.sincronizado_em`;
      gravados += lote.length;
    }
    const apagados = (await sql`delete from mailing.neo_eagle where cadastro < ${corte}::date`).count;
    await fechar({ ok: true, http: resp.status, linhas: linhas.length, pedidos: pedidos.length, gravados, apagados });
    return json({ ok: true, periodo, linhas: linhas.length, pedidos: pedidos.length, gravados, apagados }, 200);
  } catch (e) {
    const erro = ocultarToken(String((e as Error)?.message ?? e), token).slice(0, 500);
    try { await fechar({ ok: false, erro }); } catch { /* log é o de menos */ }
    console.error("sync-neo-eagle falhou");
    return json({ ok: false, erro }, 500);
  } finally {
    await sql.end({ timeout: 2 });
  }
});
