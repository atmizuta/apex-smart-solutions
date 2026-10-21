// Orquestração pura da Edge Function mailing-api (REGRAS_NEGOCIO.md seção 102): permissão, ações e respostas.
// O acesso ao banco vem injetado (DepsApi) — o index.ts implementa com a conexão direta; os testes, com falsos.
import { validarFiltros, montarWhere, validarQuantidade, sanitizarCarga, nomeArquivo } from "./consulta.ts";
import type { Filtros, SqlParte } from "./consulta.ts";

export type Usuario = { id: string; role: string; operacao: string | null; username: string | null };
export type LinhaExport = {
  nome: string; descricao: string; documento1: string; documento2: string; fone1: string; campo1: string; campo2: string; campo3: string;
};
export type RegistroExtracao = {
  user_id: string; username: string | null; role: string; operacao: string | null; nome_carga: string; filtros: Filtros;
  quantidade_pedida: number;
};
export type Contagem = { linhas: number; empresas: number; telefones: number; por_operadora: { operadora: string; linhas: number }[] };
export type DepsApi = {
  opcoes(): Promise<{ opcoes: unknown[]; carga: unknown }>;
  historico(): Promise<unknown[]>;
  contar(w: SqlParte): Promise<Contagem>;
  extrair(w: SqlParte, quantidade: number, registro: RegistroExtracao): Promise<{ linhas: LinhaExport[]; total_no_filtro: number }>;
  hojeISO(): string;
};
export type Resposta = { status: number; body: Record<string, unknown> };

export const COLUNAS_EXPORT = ["nome", "descricao", "documento1", "documento2", "fone1", "campo1", "campo2", "campo3"] as const;
const PAPEIS = new Set(["admin", "supervisor"]);

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
    const r = await deps.extrair(w, quantidade, registro);
    return {
      status: 200,
      body: {
        colunas: [...COLUNAS_EXPORT],
        linhas: r.linhas.map((l) => COLUNAS_EXPORT.map((k) => l[k] ?? "")),
        total_no_filtro: r.total_no_filtro,
        quantidade_entregue: r.linhas.length,
        nome_arquivo: nomeArquivo(carga, deps.hojeISO()),
      },
    };
  } catch (e) {
    return erroBanco(e);
  }
}
