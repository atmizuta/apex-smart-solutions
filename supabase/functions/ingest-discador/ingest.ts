// Lógica pura da Edge Function ingest-discador (sem rede, testada com node --test). Spec:
// docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md (§87). Mesmo padrão da ingest-ligacoes:
// a função valida de novo o que o robô enviou e só monta as colunas permitidas (nome e CPF nunca passam).
export const MAX_LOTE = 500;

export type LinhaDiscador = {
  id: number;
  gerada_em: string;
  conectada_em: string | null;
  atendida_em: string | null;
  fim_em: string | null;
  status: string;
  agente_id: number | null;
  seg_espera: number | null;
  seg_falados: number | null;
  seg_total: number | null;
  tabulacao: string | null;
  carga_id: number | null;
  carga: string | null;
  campanha: string | null;
  cnpj: string | null;
  telefone: string | null;
  chave_tel: string | null;
  operadora_base: string | null;
  cidade: string | null;
  regiao: string | null;
  gravacao: string | null;
};
export type LoteValidado = { linhas: LinhaDiscador[]; invalidas: number };

// Igual a chaveTel() da ingest-ligacoes e a public.chave_tel: DDD + 8 últimos dígitos.
export function chaveTel(v: unknown): string | null {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})-03:00$/;
function dataValida(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = RE_DATA.exec(s);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (h > 23 || mi > 59 || se > 59) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

// Cada helper devolve undefined quando o valor é inválido; validarLinha troca por null.
const INVALIDO = undefined;
function dataOuNulo(v: unknown): string | null | undefined {
  if (v == null) return null;
  return dataValida(v) ? v : INVALIDO;
}
function inteiroOuNulo(v: unknown, min: number, max: number): number | null | undefined {
  if (v == null) return null;
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : INVALIDO;
}
function textoOuNulo(v: unknown, max: number): string | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "string" && v.length <= max ? v : INVALIDO;
}
function padraoOuNulo(v: unknown, re: RegExp): string | null | undefined {
  if (v == null || v === "") return null;
  return typeof v === "string" && re.test(v) ? v : INVALIDO;
}

function validarLinha(r: unknown): LinhaDiscador | undefined {
  if (r === null || typeof r !== "object" || Array.isArray(r)) return INVALIDO;
  const o = r as Record<string, unknown>;
  if (typeof o.id !== "number" || !Number.isSafeInteger(o.id) || o.id <= 0) return INVALIDO;
  if (!dataValida(o.gerada_em)) return INVALIDO;
  if (typeof o.status !== "string" || !/^[A-Z_]{1,30}$/.test(o.status)) return INVALIDO;
  const l = {
    id: o.id,
    gerada_em: o.gerada_em,
    conectada_em: dataOuNulo(o.conectada_em),
    atendida_em: dataOuNulo(o.atendida_em),
    fim_em: dataOuNulo(o.fim_em),
    status: o.status,
    agente_id: inteiroOuNulo(o.agente_id, 1, 10_000_000),
    seg_espera: inteiroOuNulo(o.seg_espera, 0, 86_400),
    seg_falados: inteiroOuNulo(o.seg_falados, 0, 86_400),
    seg_total: inteiroOuNulo(o.seg_total, 0, 86_400),
    tabulacao: textoOuNulo(o.tabulacao, 200),
    carga_id: inteiroOuNulo(o.carga_id, 1, 2_000_000_000),
    carga: textoOuNulo(o.carga, 200),
    campanha: textoOuNulo(o.campanha, 200),
    cnpj: padraoOuNulo(o.cnpj, /^\d{14}$/),
    telefone: padraoOuNulo(o.telefone, /^\d{1,20}$/),
    chave_tel: null as string | null,
    operadora_base: textoOuNulo(o.operadora_base, 100),
    cidade: textoOuNulo(o.cidade, 100),
    regiao: textoOuNulo(o.regiao, 50),
    gravacao: textoOuNulo(o.gravacao, 400),
  };
  // Só id, gerada_em e status são obrigatórios (spec §5): campo opcional inválido vira null em vez de derrubar a linha.
  for (const k of Object.keys(l) as (keyof typeof l)[]) if (l[k] === INVALIDO) (l as Record<string, unknown>)[k] = null;
  l.chave_tel = chaveTel(l.telefone);
  return l as LinhaDiscador;
}

export function validarLote(lote: unknown): LoteValidado {
  if (!Array.isArray(lote)) throw new Error("lote inválido: esperado uma lista");
  if (lote.length > MAX_LOTE) throw new Error(`lote inválido: no máximo ${MAX_LOTE} linhas`);
  const out: LoteValidado = { linhas: [], invalidas: 0 };
  const vistos = new Set<number>();
  for (const r of lote) {
    const l = validarLinha(r);
    if (!l) { out.invalidas++; continue; }
    if (vistos.has(l.id)) continue;
    vistos.add(l.id);
    out.linhas.push(l);
  }
  return out;
}

export type LogExecucao = {
  execucao_id: string;
  iniciou_em: string;
  ok: boolean;
  lidas: number;
  enviadas: number;
  invalidas: number;
  periodo_de: string | null;
  periodo_ate: string | null;
  erro: string | null;
};
export type DepsIngest = {
  gravarChamadas(linhas: LinhaDiscador[]): Promise<void>;
  gravarLog(l: LogExecucao): Promise<void>;
  contarPeriodo(de: string, ate: string): Promise<number>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ruim = (msg: string): Resposta => ({ status: 400, corpo: { error: msg } });
const contagem = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isoUtcOuSP = (v: unknown): v is string =>
  typeof v === "string" && (dataValida(v) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))));

function validarFinal(c: Record<string, unknown>): LogExecucao | null {
  if (typeof c.execucao_id !== "string" || !RE_UUID.test(c.execucao_id)) return null;
  if (!isoUtcOuSP(c.iniciou_em) || typeof c.ok !== "boolean") return null;
  if (![c.lidas, c.enviadas, c.invalidas].every(contagem)) return null;
  for (const k of ["periodo_de", "periodo_ate"] as const) {
    if (c[k] != null && !isoUtcOuSP(c[k])) return null;
  }
  const erro = c.erro == null ? null : typeof c.erro === "string" ? c.erro.slice(0, 300) : undefined;
  if (erro === undefined) return null;
  return {
    execucao_id: c.execucao_id, iniciou_em: c.iniciou_em, ok: c.ok,
    lidas: c.lidas as number, enviadas: c.enviadas as number, invalidas: c.invalidas as number,
    periodo_de: (c.periodo_de as string | null | undefined) ?? null,
    periodo_ate: (c.periodo_ate as string | null | undefined) ?? null,
    erro,
  };
}

export async function processar(corpo: unknown, deps: DepsIngest): Promise<Resposta> {
  if (corpo === null || typeof corpo !== "object" || Array.isArray(corpo)) return ruim("corpo inválido");
  const c = corpo as Record<string, unknown>;
  try {
    if (c.acao === "lote") {
      let v: LoteValidado;
      try { v = validarLote(c.lote); } catch (e) { return ruim((e as Error).message); }
      if (v.linhas.length) await deps.gravarChamadas(v.linhas);
      return { status: 200, corpo: { recebidas: (c.lote as unknown[]).length, gravadas: v.linhas.length, invalidas: v.invalidas } };
    }
    if (c.acao === "final") {
      const log = validarFinal(c);
      if (!log) return ruim("resumo inválido");
      await deps.gravarLog(log);
      return { status: 200, corpo: { ok: true } };
    }
    if (c.acao === "contar") {
      if (!dataValida(c.de) || !dataValida(c.ate)) return ruim("período inválido");
      return { status: 200, corpo: { total: await deps.contarPeriodo(c.de, c.ate) } };
    }
    return ruim("ação desconhecida");
  } catch (e) {
    console.error("ingest-discador:", (e as Error).message.replace(/\d{8,}/g, "#").slice(0, 200));
    return { status: 500, corpo: { error: "erro interno" } };
  }
}
