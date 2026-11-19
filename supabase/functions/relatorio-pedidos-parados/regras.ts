// Regras puras do relatório diário de pedidos parados (Antifraude e Entrega). Spec:
// docs/superpowers/specs/2026-10-13-relatorio-pedidos-parados-email-design.md (§3). REGRAS_NEGOCIO.md §81.
// Dias úteis e feriados seguem a regra do Dashboard de Produção (§48.2), copiada porque a Edge Function não
// enxerga o painel — com o Carnaval na segunda e terça (Páscoa − 48 e − 47).

export const ETAPAS = ["ANTIFRAUDE (NEOCRM)", "ENTREGA (NEOCRM)"] as const;
export type Criticidade = "alta" | "media" | "baixa";
export const CRITICIDADES: Criticidade[] = ["alta", "media", "baixa"];
export const FAIXAS = { media: 4, alta: 7 } as const;
export const ROTULO: Record<Criticidade, string> = { alta: "ALTA", media: "MÉDIA", baixa: "BAIXA" };

export interface Linha {
  numero_pedido: string | null;
  usuario: string | null;
  etapa: string;
  cadastro: string | null;
  atualizacao: string | null;
  valor: number | string | null;
  quantidade: number | string | null;
  produto: string | null;
  cliente: string | null;
  cnpj: string | null;
  na_etapa_desde: string | null;
  operacao: string | null;
}

export interface Pedido {
  numero_pedido: string;
  etapa: string;
  operacao: "Apex" | "Campinas";
  consultor: string;
  cliente: string;
  cnpj: string;
  produtos: string;
  qtd: number;
  valor: number;
  cadastro: string | null;
  na_etapa_desde: string | null;
  atualizacao: string | null;
  dias: number;
  criticidade: Criticidade;
}

export type Contagem = Record<Criticidade | "total", number>;
export interface Resumo { porEtapa: Record<string, Contagem>; total: Contagem }

const FMT_SP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
function partesSp(d: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const x of FMT_SP.formatToParts(d)) p[x.type] = x.value;
  p.hour = String(parseInt(p.hour, 10) % 24).padStart(2, "0");
  return p;
}

export function diaSp(v: string | Date | null | undefined): string | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = partesSp(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export function fmtDiaBr(dia: string): string {
  const [y, m, d] = dia.split("-");
  return `${d}/${m}/${y}`;
}

export function fmtDataHoraSp(d: Date): string {
  const p = partesSp(d);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function somarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Páscoa pelo algoritmo de Meeus/Jones/Butcher (o mesmo do painel).
function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

const CACHE_FERIADOS = new Map<number, Set<string>>();
export function feriadosNacionais(ano: number): Set<string> {
  const pronto = CACHE_FERIADOS.get(ano);
  if (pronto) return pronto;
  const s = new Set<string>();
  for (const md of ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"]) s.add(`${ano}-${md}`);
  const p = pascoa(ano);
  for (const off of [-48, -47, -2, 60]) s.add(somarDias(p, off)); // Carnaval seg/ter, Sexta Santa, Corpus Christi
  CACHE_FERIADOS.set(ano, s);
  return s;
}

export function ehDiaUtil(dia: string): boolean {
  const [y, m, d] = dia.split("-").map(Number);
  const sem = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (sem === 0 || sem === 6) return false;
  return !feriadosNacionais(y).has(dia);
}

// Dias úteis DEPOIS de diaIni até diaRef (inclusive). Ex.: sexta → segunda = 1.
export function diasUteisDesde(diaIni: string, diaRef: string): number {
  if (!diaIni || !diaRef || diaRef <= diaIni) return 0;
  let n = 0;
  for (let d = somarDias(diaIni, 1); d <= diaRef; d = somarDias(d, 1)) if (ehDiaUtil(d)) n++;
  return n;
}

export function criticidade(dias: number): Criticidade {
  if (dias >= FAIXAS.alta) return "alta";
  if (dias >= FAIXAS.media) return "media";
  return "baixa";
}

export function etapaCurta(etapa: string): string {
  return String(etapa ?? "").replace(/\s*\(NEOCRM\)\s*$/i, "").trim();
}

const instante = (iso: string | null): number => (iso ? new Date(iso).getTime() : NaN);
const numero = (v: number | string | null): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function montarPedidos(linhas: Linha[], diaRef: string): Pedido[] {
  const porPedido = new Map<string, Linha[]>();
  for (const l of linhas ?? []) {
    if (!l || !(ETAPAS as readonly string[]).includes(l.etapa)) continue;
    const num = l.numero_pedido == null ? "" : String(l.numero_pedido).trim();
    if (!num) continue;
    const grupo = porPedido.get(num);
    if (grupo) grupo.push(l); else porPedido.set(num, [l]);
  }

  const lista: Pedido[] = [];
  for (const [num, ls] of porPedido) {
    // linha de referência = a de ATUALIZACAO mais recente (sem data vai para o fim)
    const ordenadas = [...ls].sort((a, b) => {
      const ta = instante(a.atualizacao), tb = instante(b.atualizacao);
      if (isNaN(ta)) return isNaN(tb) ? 0 : 1;
      if (isNaN(tb)) return -1;
      return tb - ta;
    });
    const ref = ordenadas[0];
    const texto = (campo: keyof Linha): string => {
      const r = ls.find((x) => x[campo] != null && String(x[campo]).trim() !== "");
      return r ? String(r[campo]).trim() : "";
    };
    const cadastros = ls.map((x) => x.cadastro).filter((c): c is string => !!c && !isNaN(instante(c)))
      .sort((a, b) => instante(a) - instante(b));
    const desde = ref.na_etapa_desde || ref.atualizacao || cadastros[0] || null;
    const diaDesde = diaSp(desde);
    const dias = diaDesde ? diasUteisDesde(diaDesde, diaRef) : 0;
    const produtos = [...new Set(ls.map((x) => x.produto).filter((p) => p != null && String(p).trim() !== "")
      .map((p) => String(p).trim()))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    lista.push({
      numero_pedido: num,
      etapa: ref.etapa,
      operacao: texto("operacao").toLowerCase() === "campinas" ? "Campinas" : "Apex",
      consultor: texto("usuario"),
      cliente: texto("cliente"),
      cnpj: texto("cnpj"),
      produtos: produtos.join(" + "),
      qtd: ls.reduce((s, x) => s + numero(x.quantidade), 0),
      valor: Math.round(ls.reduce((s, x) => s + numero(x.valor), 0) * 100) / 100,
      cadastro: cadastros[0] ?? null,
      na_etapa_desde: desde,
      atualizacao: ref.atualizacao ?? null,
      dias,
      criticidade: criticidade(dias),
    });
  }

  const ordemEtapa = (e: string) => (ETAPAS as readonly string[]).indexOf(e);
  lista.sort((a, b) => (b.dias - a.dias) || (ordemEtapa(a.etapa) - ordemEtapa(b.etapa))
    || a.numero_pedido.localeCompare(b.numero_pedido, "pt-BR", { numeric: true }));
  return lista;
}

const zero = (): Contagem => ({ alta: 0, media: 0, baixa: 0, total: 0 });
export function resumir(pedidos: Pedido[]): Resumo {
  const porEtapa: Record<string, Contagem> = {};
  for (const e of ETAPAS) porEtapa[e] = zero();
  const total = zero();
  for (const p of pedidos) {
    const c = porEtapa[p.etapa] ?? (porEtapa[p.etapa] = zero());
    c[p.criticidade]++; c.total++;
    total[p.criticidade]++; total.total++;
  }
  return { porEtapa, total };
}
