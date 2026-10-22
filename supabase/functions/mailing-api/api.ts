// Orquestração pura da Edge Function mailing-api (REGRAS_NEGOCIO.md seção 102): permissão, ações e respostas.
// O acesso ao banco vem injetado (DepsApi) — o index.ts implementa com a conexão direta; os testes, com falsos.
import { validarFiltros, montarWhere, validarQuantidade, sanitizarCarga, nomeArquivo, validarTrecho, proximoTrecho } from "./consulta.ts";
import type { Filtros, SqlParte, Trecho, ResultadoTrecho } from "./consulta.ts";

export type Usuario = { id: string; role: string; operacao: string | null; username: string | null };
export type LinhaExport = {
  nome: string; descricao: string; documento1: string; documento2: string; fone1: string; campo1: string; campo2: string; campo3: string;
};
export type RegistroExtracao = {
  user_id: string; username: string | null; role: string; operacao: string | null; nome_carga: string; filtros: Filtros;
  quantidade_pedida: number;
};
export type RegistroParte = RegistroExtracao & { pedido: string; parte: number };
export type PedidoTrecho = { trecho: Trecho; quantidade: number; inicio: string; nunca_extraida: boolean };
export type Contagem = { linhas: number; empresas: number; telefones: number; por_operadora: { operadora: string; linhas: number }[] };
export type DepsApi = {
  opcoes(): Promise<{ opcoes: unknown[]; carga: unknown }>;
  historico(): Promise<unknown[]>;
  contar(w: SqlParte): Promise<Contagem>;
  extrair(w: SqlParte, quantidade: number, registro: RegistroExtracao): Promise<{ linhas: LinhaExport[]; total_no_filtro: number }>;
  extrairTrecho(w: SqlParte, pedido: PedidoTrecho, registro: RegistroParte): Promise<{ linhas: LinhaExport[]; resultado: ResultadoTrecho }>;
  neo(): Promise<unknown[]>;
  fecharParte(pedido: string, parte: number, userId: string, neo: number, repetidos: number): Promise<boolean>;
  hojeISO(): string;
};
export type Resposta = { status: number; body: Record<string, unknown> };

export const COLUNAS_EXPORT = ["nome", "descricao", "documento1", "documento2", "fone1", "campo1", "campo2", "campo3"] as const;
const PAPEIS = new Set(["admin", "supervisor"]);
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validarPedidoParte(c: Record<string, unknown>): { ok: true; pedido: string; parte: number } | { ok: false; erro: string } {
  if (typeof c.pedido !== "string" || !RE_UUID.test(c.pedido)) return { ok: false, erro: "pedido inválido" };
  if (!Number.isInteger(c.parte) || (c.parte as number) < 1 || (c.parte as number) > 1000) return { ok: false, erro: "parte inválida" };
  return { ok: true, pedido: c.pedido.toLowerCase(), parte: c.parte as number };
}
const ehContagem = (x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 10_000_000;

function erroBanco(e: unknown): Resposta {
  if ((e as { code?: string } | null)?.code === "57014") {
    return { status: 504, body: { erro: "A consulta demorou demais. Refine os filtros e tente de novo." } };
  }
  return { status: 500, body: { erro: "Falha ao consultar a base de mailing." } };
}

export async function processar(corpo: unknown, usuario: Usuario | null, deps: DepsApi): Promise<Resposta> {
  if (!usuario || !PAPEIS.has(usuario.role)) return { status: 403, body: { erro: "Sem permissão para a base de mailing." } };
  const c = corpo && typeof corpo === "object" && !Array.isArray(corpo) ? corpo as Record<string, unknown> : {};
  const acao = c.acao;
  try {
    if (acao === "opcoes") return { status: 200, body: await deps.opcoes() };
    if (acao === "historico") return { status: 200, body: { extracoes: await deps.historico() } };
    // 22/10 (seção 102.12): lista do NeoSales para cruzar; removidos de cada arquivo no histórico
    if (acao === "neo") return { status: 200, body: { empresas: await deps.neo() } };
    if (acao === "fechar_parte") {
      const pp = validarPedidoParte(c);
      if (!pp.ok) return { status: 400, body: { erro: pp.erro } };
      if (!ehContagem(c.neo) || !ehContagem(c.repetidos)) return { status: 400, body: { erro: "removidos: use números inteiros a partir de 0" } };
      const gravou = await deps.fecharParte(pp.pedido, pp.parte, usuario.id, c.neo as number, c.repetidos as number);
      return gravou ? { status: 200, body: { ok: true } } : { status: 404, body: { erro: "Parte do pedido não encontrada." } };
    }
    if (acao !== "contar" && acao !== "extrair") return { status: 400, body: { erro: "Ação inválida." } };
    const v = validarFiltros(c.filtros);
    if (!v.ok) return { status: 400, body: { erro: v.erro } };
    const w = montarWhere(v.filtros);
    if (acao === "contar") return { status: 200, body: { ...(await deps.contar(w)) } };
    const quantidade = validarQuantidade(c.quantidade);
    if (quantidade === null) return { status: 400, body: { erro: "Quantidade deve ser um número inteiro de 1 a 100.000." } };
    const carga = sanitizarCarga(c.nome_carga);
    if (!carga) return { status: 400, body: { erro: "Informe o nome da carga." } };
    const registro: RegistroExtracao = {
      user_id: usuario.id, username: usuario.username, role: usuario.role, operacao: usuario.operacao,
      nome_carga: carga, filtros: v.filtros, quantidade_pedida: quantidade,
    };
    const linhaEmLista = (l: LinhaExport) => COLUNAS_EXPORT.map((k) => l[k] ?? "");
    // 22/10 (seção 102.10): o painel novo manda "trecho" e repete as chamadas; sem "trecho" é o painel antigo (aba aberta)
    if (c.trecho !== undefined) {
      const t = validarTrecho(c.trecho);
      if (!t.ok) return { status: 400, body: { erro: t.erro } };
      const pp = validarPedidoParte(c);
      if (!pp.ok) return { status: 400, body: { erro: pp.erro } };
      const inicio = v.filtros.extraida_antes_de;
      if (!inicio) return { status: 400, body: { erro: "Falta o início do pedido (extraida_antes_de)." } };
      const ped: PedidoTrecho = { trecho: t.trecho, quantidade, inicio, nunca_extraida: !!v.filtros.nunca_extraida };
      const r = await deps.extrairTrecho(w, ped, { ...registro, pedido: pp.pedido, parte: pp.parte });
      const body: Record<string, unknown> = {
        colunas: [...COLUNAS_EXPORT],
        linhas: r.linhas.map(linhaEmLista),
        quantidade_entregue: r.linhas.length,
        nome_arquivo: nomeArquivo(carga, deps.hojeISO()),
        proxima: proximoTrecho(r.resultado, quantidade, ped.nunca_extraida),
      };
      if (r.resultado.fase === 1 && t.trecho.fase === 1) {
        body.paginas_total = r.resultado.paginas_total;
        body.paginas_lidas = Math.max(0, r.resultado.ate - t.trecho.pagina);
      }
      return { status: 200, body };
    }
    const r = await deps.extrair(w, quantidade, registro);
    return {
      status: 200,
      body: {
        colunas: [...COLUNAS_EXPORT],
        linhas: r.linhas.map(linhaEmLista),
        total_no_filtro: r.total_no_filtro,
        quantidade_entregue: r.linhas.length,
        nome_arquivo: nomeArquivo(carga, deps.hojeISO()),
      },
    };
  } catch (e) {
    return erroBanco(e);
  }
}
