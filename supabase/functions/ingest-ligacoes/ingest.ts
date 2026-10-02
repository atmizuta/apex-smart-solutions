// Lógica pura da Edge Function ingest-ligacoes (sem rede, testada com node --test).
// Mesmas regras de mlParseRelatorio no _template.html (REGRAS_NEGOCIO.md 59.3 e 65): a função valida de novo o que o
// robô enviou, porque o robô é só um cliente — o banco não confia em ninguém.
export const MAX_LOTE = 500;

export type LinhaDb = {
  id: number;
  usuario: string;
  telefone: string | null;
  chave_tel: string | null;
  gerada_em: string; // ISO com -03:00 (São Paulo)
  atendida: boolean;
  seg_falados: number;
  tabulacao: string | null;
  transferido: string | null;
  gravacao: string | null;
};
export type LoteValidado = { linhas: LinhaDb[]; invalidas: number; ignoradasEagle: number };

// Telefone -> DDD + 8 últimos dígitos (ignora o 9º dígito e o 55 inicial). Igual a chaveTel() do painel e a public.chave_tel.
export function chaveTel(v: unknown): string | null {
  let d = String(v == null ? "" : v).replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  return d.length >= 10 ? d.slice(0, 2) + d.slice(-8) : null;
}

// Usuários da Eagle não fazem parte da operação (REGRAS 65). O gatilho do banco também descarta.
export function ehEagle(usuario: unknown): boolean {
  return /^eagle/i.test(String(usuario ?? "").trim());
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

// string curta ou nula; qualquer outro tipo (ou texto longo) devolve undefined = inválido
function textoOuNulo(v: unknown, max: number): string | null | undefined {
  if (v == null) return null;
  if (typeof v !== "string" || v.length > max) return undefined;
  return v;
}

export function validarLote(lote: unknown): LoteValidado {
  if (!Array.isArray(lote)) throw new Error("lote inválido: esperado uma lista");
  if (lote.length > MAX_LOTE) throw new Error(`lote inválido: no máximo ${MAX_LOTE} linhas`);
  const out: LoteValidado = { linhas: [], invalidas: 0, ignoradasEagle: 0 };
  const vistos = new Set<number>();
  for (const r of lote as Record<string, unknown>[]) {
    if (r === null || typeof r !== "object" || Array.isArray(r)) { out.invalidas++; continue; }
    const id = r.id;
    const usuario = typeof r.usuario === "string" ? r.usuario.trim() : "";
    const telefone = r.telefone == null || r.telefone === "" ? null : r.telefone;
    const tab = textoOuNulo(r.tabulacao, 200);
    const transf = textoOuNulo(r.transferido, 200);
    const grav = textoOuNulo(r.gravacao, 400);
    const seg = r.seg_falados;
    if (
      typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 ||
      !usuario || usuario.length > 80 ||
      !dataValida(r.gerada_em) ||
      typeof r.atendida !== "boolean" ||
      typeof seg !== "number" || !Number.isInteger(seg) || seg < 0 || seg > 86400 ||
      (telefone !== null && (typeof telefone !== "string" || !/^\d{1,20}$/.test(telefone))) ||
      tab === undefined || transf === undefined || grav === undefined
    ) { out.invalidas++; continue; }
    if (ehEagle(usuario)) { out.ignoradasEagle++; continue; }
    if (vistos.has(id)) continue;
    vistos.add(id);
    out.linhas.push({
      id, usuario, telefone: telefone as string | null, chave_tel: chaveTel(telefone), gerada_em: r.gerada_em as string,
      atendida: r.atendida, seg_falados: seg, tabulacao: tab, transferido: transf, gravacao: grav,
    });
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
  ignoradas_eagle: number;
  periodo_de: string | null;
  periodo_ate: string | null;
  erro: string | null;
};
export type DepsIngest = {
  gravarLigacoes(linhas: LinhaDb[]): Promise<void>;
  gravarLog(l: LogExecucao): Promise<void>;
  contarPeriodo(de: string, ate: string): Promise<number>;
};
export type Resposta = { status: number; corpo: Record<string, unknown> };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ruim = (msg: string): Resposta => ({ status: 400, corpo: { error: msg } });
const inteiro = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 10_000_000;
const isoUtcOuSP = (v: unknown): v is string =>
  typeof v === "string" && (dataValida(v) || (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && Number.isFinite(Date.parse(v))));

function validarFinal(c: Record<string, unknown>): LogExecucao | null {
  if (typeof c.execucao_id !== "string" || !RE_UUID.test(c.execucao_id)) return null;
  if (!isoUtcOuSP(c.iniciou_em) || typeof c.ok !== "boolean") return null;
  if (![c.lidas, c.enviadas, c.invalidas, c.ignoradas_eagle].every(inteiro)) return null;
  for (const k of ["periodo_de", "periodo_ate"] as const) {
    if (c[k] != null && !isoUtcOuSP(c[k])) return null;
  }
  const erro = c.erro == null ? null : typeof c.erro === "string" ? c.erro.slice(0, 300) : undefined;
  if (erro === undefined) return null;
  return {
    execucao_id: c.execucao_id, iniciou_em: c.iniciou_em, ok: c.ok,
    lidas: c.lidas as number, enviadas: c.enviadas as number, invalidas: c.invalidas as number,
    ignoradas_eagle: c.ignoradas_eagle as number,
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
      if (v.linhas.length) await deps.gravarLigacoes(v.linhas);
      return {
        status: 200,
        corpo: { recebidas: (c.lote as unknown[]).length, gravadas: v.linhas.length, invalidas: v.invalidas, ignoradasEagle: v.ignoradasEagle },
      };
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
    // o detalhe vai para o log do servidor (index.ts); a resposta nunca ecoa dados recebidos
    console.error("ingest-ligacoes:", (e as Error).message.slice(0, 200));
    return { status: 500, corpo: { error: "erro interno" } };
  }
}
